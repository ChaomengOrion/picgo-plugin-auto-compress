import { IPicGo, IPathTransformedImgInfo, IPluginConfig, IPlugin, IImgSize, IImgInfo } from 'picgo'
import sharp from 'sharp';
import type { Sharp } from 'sharp';
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
        },
        {
            alias: '备选图片类型1',
            name: 'secondFileType',
            type: 'list',
            message: '选择优先使用的图片类型在不支持解码的情况下的备选图片类型',
            choices: _choices,
            default: conf?.secondFileType || FileType.webp,
            required: false,
        },
        {
            alias: '备选图片类型2',
            name: 'thirdFileType',
            type: 'list',
            message: '选择优先使用的图片类型在不支持解码的情况下的备选图片类型',
            choices: _choices,
            default: conf?.thirdFileType || FileType.jpeg,
            required: false,
        },
        {
            alias: '上传结果输出格式',
            name: 'outputFormat',
            type: 'list',
            choices: Object.keys(OutputFormat),
            message: '上传结果的输出格式，extra会添加packinfo到http返回，可配合obsidian插件实现优雅插入html标签',
            default: conf?.outputFormat || OutputFormat.extra,
            required: true,
        },
        {
            alias: '优先以首选图片类型而不是原图的链接作为图库存储链接',
            name: 'saveFirst',
            type: 'confirm',
            message: '优先以首选图片类型而不是原图的链接作为图库存储链接',
            default: conf?.saveFirst || true,
            required: false,
        },
        {
            alias: '跳过转换为原图一样的格式，除非选项为原图',
            name: 'skipSourceFileType',
            type: 'confirm',
            message: '跳过转换为原图一样的格式，除非选项为原图',
            default: conf?.skipSourceFileType || false,
            required: false,
        },
        {
            alias: '启用Avif无损压缩',
            name: 'losslessAvif',
            type: 'confirm',
            message: '启用Avif无损压缩',
            default: conf?.losslessAvif || false,
            required: false,
        },
        {
            alias: 'avif输出质量(1-100)',
            name: 'qualityOfAvif',
            type: 'input',
            message: '不启用无损时，avif输出质量(1-100)',
            default: conf?.qualityOfAvif || '50',
            required: false,
        },
        {
            alias: 'webp输出质量(1-100)',
            name: 'qualityOfWebp',
            type: 'input',
            message: 'webp输出质量(1-100)',
            default: conf?.qualityOfWebp || '80',
            required: false,
        },
        {
            alias: 'jpeg输出质量(1-100)',
            name: 'qualityOfJpeg',
            type: 'input',
            message: 'jpeg输出质量(1-100)',
            default: conf?.qualityOfJpeg || '80',
            required: false,
        },
        {
            alias: '启用Heif无损压缩',
            name: 'losslessHeif',
            type: 'confirm',
            message: '启用Heif无损压缩',
            default: conf?.losslessHeif || false,
            required: false,
        },
        {
            alias: 'heif输出质量(1-100)',
            name: 'qualityOfHeif',
            type: 'input',
            message: '不启用无损时，heif输出质量(1-100)',
            default: conf?.qualityOfHeif || '50',
            required: false,
        }
    ];
    return configs;
};

const setFileFormat = (img: Sharp, targetFormat: FileTypeForSharp, setting: IConfig): Sharp => {
    switch (targetFormat) {
        case FileType.avif:
            img = setting.losslessAvif ?
                img.avif({ lossless: true }) :
                img.avif({ quality: Number.parseInt(setting.qualityOfAvif) });
            break;
        case FileType.heif:
            img = setting.losslessHeif ?
                img.heif({ lossless: true }) :
                img.heif({ quality: Number.parseInt(setting.qualityOfHeif) });
            break;
        case FileType.webp:
            img = img.webp({ quality: Number.parseInt(setting.qualityOfWebp) });
            break;
        case FileType.jpeg:
            img = img.jpeg({ quality: Number.parseInt(setting.qualityOfJpeg) });
            break;
        default:
            img.toFormat(targetFormat);
            break;
    }
    return img;
}

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
                let originFileName = info.fileName;

                if (!originFileName) {
                    originFileName = `${dayjs().format('YYYYMMDDHHmmssSSS')}${originExtname}`;
                    ctx.log.info(`检查输入为剪切板类型的图片，自动命名为[${originFileName}]`)
                }
                const originFileType: FileTypeForSharp = getFileTypeFromExtname(originExtname);
                if (!originFileType) {
                    ctx.log.error(`不支持的图片拓展名: [${originExtname}]`);
                    ctx.emit('notification', {
                        title: '尝试转换时出错',
                        body: '不支持的图片拓展名',
                        text: ''
                    });
                    return;
                }

                ctx.log.info(`输入文件名字为[${originFileName}]`)
                ctx.log.info(`输入文件类型为[${originFileType}]`)

                const transformTypes: ITransformInfo[] = [config.firstFileType, config.secondFileType, config.thirdFileType]
                    .filter(p => p && (!config.skipSourceFileType || p != originFileType) && p != FileType.none) //* 过滤不符合要求的目标转换格式
                    .map(type => {
                        const newType: FileTypeForSharp = (type == FileType.raw ? originFileType : type as FileTypeForSharp);
                        return {
                            newExtname: FileTypeMap[newType].extname!,
                            newFileName: `${originFileName}${FileTypeMap[newType].extname}`,
                            toFormat: newType
                        };
                    });

                //* 输出原图
                results.push({
                    buffer: info.buffer,
                    fileName: originFileName,
                    width: imgSize.width,
                    height: imgSize.height,
                    extname: originFileName,
                    _packInfo: transformTypes
                });
                ctx.log.success(`压缩插件输出原图成功，文件名为[${originFileName}]`);

                //* 输出压缩图
                await Promise.all(
                    transformTypes.map(async (t: ITransformInfo) => {
                        ctx.log.success(`压缩插件开始压缩图片格式[${t.toFormat}]`);
                        const img = setFileFormat(sharp(info.buffer), t.toFormat, config);

                        results.push({
                            buffer: await img.toBuffer(), //* Transform format
                            fileName: t.newFileName,
                            width: imgSize.width,
                            height: imgSize.height,
                            extname: t.newExtname,
                            _isSubImage: true, // 这里额外开了一个键记录，方便后面在afterUploadPlugins删掉
                            _sourceFileName: originFileName
                        });
                        ctx.log.success(`压缩插件输出图片格式[${t.toFormat}]成功，文件名为[${t.newFileName}]`);
                    })
                );
                //* End Output
            } else {
                ctx.log.error(info.reason);
                ctx.emit('notification', {
                    title: '读取图片时出错',
                    body: info.reason,
                    text: ''
                });
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
            const transformerPackInfo: ITransformInfo[] = source._packInfo!;
            const subImageInfos: ICustomImgInfo[] = (ctx.output as ICustomImgInfo[]).filter(p => p._isSubImage && p._sourceFileName == source.fileName);
            const imgUrlList = transformerPackInfo.map(t => {
                const sub = subImageInfos.find(p => p.fileName == t.newFileName)!;
                return {
                    imgUrl: sub.imgUrl!,
                    imgWebType: FileTypeMap[t.toFormat].webType!
                };
            });
            const {
                _packInfo: _,
                imgUrl: sourceUrl,
                ...newSource
            } = source;
            return {
                _packInfo: {
                    imageList: imgUrlList,
                    sourceImageUrl: source.imgUrl!
                },
                imgUrl: config.saveFirst ? (imgUrlList[0]?.imgUrl || sourceUrl) : sourceUrl,
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
                const sources: string = info._packInfo.imageList.map(p => `<source srcSet="${p.imgUrl}" type="${p.imgWebType}"/>`).join('');
                const html = `<picture>${sources}<img src="${info._packInfo.sourceImageUrl}"/></picture>`;
                const {
                    _packInfo: _,
                    ...newInfo
                } = info;
                newInfo.imgUrl = html;
                return newInfo;
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
