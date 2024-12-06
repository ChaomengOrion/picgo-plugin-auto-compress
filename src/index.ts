import { IPicGo, IPathTransformedImgInfo, IPluginConfig, IPlugin, IImgSize } from 'picgo'
import sharp from 'sharp';
////import fs from 'fs';
////import path from 'path';
import dayjs from 'dayjs'
import { isUrl, getURLFile, getFSFile, getImgSize } from './utils';
import { FileType, FileTypeMap, IConfig, OutputFormat, getFileTypeFromExtname, FileTypeForSharp } from './config'
import { ITransformInfo, ICustomImgInfo, IPackImgInfo } from './interfaces';

const PLUGIN_NAME = 'auto-compress';

const getConfig = (ctx: IPicGo) => ctx.getConfig<IConfig>('picgo-plugin-auto-compress') || ctx.getConfig<IConfig>(`transformer.${PLUGIN_NAME}`);

/** 插件配置 */
const pluginConfig = (ctx: IPicGo): IPluginConfig[] => {
    const conf = getConfig(ctx);
    //? 这里PicList会多显示一个图床名称的无效配置项，调了半天，发现PicList会多生成一个_config键，PicGo就正常，似乎是写死在PicList源码里面的，不管了
    const _choices = Object.keys(FileType).map(key => ({ name: FileTypeMap[key].alias, value: key }));
    const configs: IPluginConfig[] = [
        {
            alias: '首选图片类型',
            name: 'firstFileType',
            type: 'list',
            message: '选择优先使用的图片类型',
            choices: _choices,
            default: conf?.firstFileType || FileType.avif,
            required: true,
        }, {
            alias: '备选图片类型1',
            name: 'secondFileType',
            type: 'list',
            message: '选择优先使用的图片类型在不支持解码的情况下的备选图片类型',
            choices: _choices.filter(p => p.value !== conf?.firstFileType),
            default: conf?.secondFileType || FileType.avif,
            required: false,
        }, {
            alias: '备选图片类型2',
            name: 'thirdFileType',
            type: 'list',
            message: '选择优先使用的图片类型在不支持解码的情况下的备选图片类型',
            choices: _choices.filter(p => p.value !== conf?.firstFileType && p.value !== conf?.secondFileType),
            default: conf?.thirdFileType || FileType.avif,
            required: false,
        },
        {
            alias: '上传结果输出格式',
            name: 'outputFormat',
            type: 'list',
            choices: Object.keys(OutputFormat),
            message: '上传结果输出格式',
            default: conf?.outputFormat || OutputFormat.url,
            required: true,
        }
    ];
    return configs;
};

/** 处理格式转换和压缩 */
const transformer: IPlugin = {
    async handle(ctx: IPicGo): Promise<IPicGo> {
        const config = getConfig(ctx);
        if (!config) {
            ctx.emit('notification', {
                title: '请先配置插件',
                body: '缺少压缩插件配置',
                text: ''
            });
            throw new Error("No config");
        }

        const results: ICustomImgInfo[] = ctx.output;
        await Promise.all(ctx.input.map(async (item: string | Buffer, index: number) => {
            let info: IPathTransformedImgInfo
            if (Buffer.isBuffer(item)) {
                info = {
                    success: true,
                    buffer: item,
                    fileName: '', // will use getImageSize result
                    extname: '' // will use getImageSize result
                }
            } else if (isUrl(item)) {
                info = await getURLFile(item, ctx)
            } else {
                info = await getFSFile(item)
            }

            if (info.success && info.buffer) {
                //* Begin Output
                const imgSize: IImgSize = getImgSize(ctx, info.buffer, item);
                const originExtname = info.extname || imgSize.extname || '.png';
                let originFileName: string = info.fileName;

                if (!originFileName) {
                    originFileName = `${dayjs().format('YYYYMMDDHHmmssSSS')}${originExtname}`;
                    ctx.log.info(`检查输入为剪切板类型的图片，自动命名为[${originFileName}]`)
                }
                const originFileType: FileType = getFileTypeFromExtname(originExtname); //! TODO: 判断不支持的格式
                ctx.log.info(`输入文件名字为[${originFileName}]`)
                ctx.log.info(`输入文件类型为[${originFileType}]`)

                const transformTypes: ITransformInfo[] = [config.firstFileType, config.secondFileType, config.thirdFileType]
                    .filter(p => p && p != originFileType && p != FileType.none && p != FileType.raw) // TODO: 压缩原图
                    .map(type => ({
                        newExtname: FileTypeMap[type].extname,
                        newFileName: `${originFileName}${FileTypeMap[type].extname}`,
                        toFormat: type as FileTypeForSharp
                    }));

                //* 输出原图
                results.push({
                    buffer: info.buffer,
                    fileName: originFileName,
                    width: imgSize.width,
                    height: imgSize.height,
                    extname: originFileName,
                    _packInfo: transformTypes
                });
                ctx.log.success(`压缩插件输出原图成功，文件名为${originFileName}`);

                //* 输出压缩图
                await Promise.all(
                    transformTypes.map(async (t: ITransformInfo) => {
                        ctx.log.success(`压缩插件开始压缩图片格式[${t.toFormat}]`);
                        const _buffer: Buffer = await sharp(info.buffer).toFormat(t.toFormat).toBuffer(); //* Transform format

                        results.push({
                            buffer: _buffer,
                            fileName: t.newFileName,
                            width: imgSize.width,
                            height: imgSize.height,
                            extname: t.newExtname,
                            _isSubImage: true, // 这里额外开了一个键记录，方便后面在afterUploadPlugins删掉
                            _sourceFileName: originFileName
                        });
                        ctx.log.success(`压缩插件输出图片格式[${t.toFormat}]成功，文件名为${t.newFileName}`);
                    })
                );
                //* End Output
            } else {
                ctx.log.error(info.reason);
                ctx.emit('notification', {
                    title: '格式转换时出现错误',
                    body: info.reason,
                    text: ''
                })
            }
        }));
        //! Remove empty item
        ctx.output = results.filter(item => item);
        return ctx
    }
}

/** 筛掉其他不需要的格式 */
const afterUploadPlugins: IPlugin = {
    handle(ctx: IPicGo) {
        const config = getConfig(ctx);
        if (!config?.outputFormat) return ctx;

        //ctx.log.info(JSON.stringify(ctx.output));

        const sourceImageInfos: ICustomImgInfo[] = (ctx.output as ICustomImgInfo[]).filter(p => p._packInfo);

        if (sourceImageInfos.length == 0) return ctx; // 未经过压缩

        //* 构建outputPackinfo
        let outputPackinfo: IPackImgInfo[] = sourceImageInfos.map(source => {
            const transformerPackInfo: ITransformInfo[] = source._packInfo;
            const subImageInfos: ICustomImgInfo[] = (ctx.output as ICustomImgInfo[]).filter(p => p._isSubImage && p._sourceFileName == source.fileName);
            const imgUrlList = transformerPackInfo.map(t => {
                const sub = subImageInfos.find(p => p.fileName == t.newFileName);
                return {
                    imgUrl: sub.imgUrl,
                    imgWebType: FileTypeMap[t.toFormat].webType
                };
            });
            const {
                _packInfo: _,
                ...newSource
            } = source;
            return {
                _packInfo: {
                    imageList: imgUrlList,
                    sourceImageUrl: source.imgUrl
                },
                ...newSource
            };
        });

        ctx.output = (ctx.output as ICustomImgInfo[]).filter(p => (!p._isSubImage || p._isSubImage != true) && !p._packInfo); // 筛掉经过处理的压缩图和原图

        //* 输出outputPackinfo内容
        if (config.outputFormat === OutputFormat.extra) {
            ctx.log.info(`输出带outputPackinfo的自定义格式`);
            ctx.output = ctx.output.concat(outputPackinfo);
        }
        else if (config.outputFormat === OutputFormat.html) {
            ctx.log.info(`输出html格式`);
            ctx.output = ctx.output.concat(outputPackinfo.map(info => {
                const sources: string = info._packInfo.imageList.map(p => `<source srcSet="${p.imgUrl}" type="${p.imgWebType}"/>`).join();
                return `<picture>${sources}<img src="${info._packInfo.sourceImageUrl}"/></picture>`
            }));
        } else if (config.outputFormat === OutputFormat.url) {
            ctx.log.info(`输出不带自定义信息的url格式`);
            ctx.output = ctx.output.concat(outputPackinfo.map(info => {
                const {
                    _packInfo: _,
                    ...newInfo
                } = info;
                return newInfo;
            }));
        }
        
        //ctx.log.info(JSON.stringify(ctx.output));
        return ctx;
    }
};

export = (ctx: IPicGo) => {
    const register = () => {
        ctx.helper.afterUploadPlugins.register(PLUGIN_NAME, afterUploadPlugins);
        ctx.helper.transformer.register(PLUGIN_NAME, transformer);
    };

    return {
        transformer: PLUGIN_NAME,
        config: pluginConfig,
        register
    };
};
