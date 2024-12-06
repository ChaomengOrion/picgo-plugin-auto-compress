export enum FileType {
    raw = 'raw',
    avif = 'avif',
    webp = 'webp',
    jpeg = 'jpeg',
    png = 'png',
    gif = 'gif',
    heif = 'heif',
    jxl = 'jxl', // TODO
    tiff = 'tiff',
    none = 'none'
}

export type FileTypeForSharp = FileType.avif | FileType.webp | FileType.jpeg | FileType.png | FileType.gif | FileType.heif | FileType.jxl | FileType.tiff

// TODO: HDR Support

export interface IFileTypeInfo {
    alias: string,
    extname: string | null,
    webType: string | null,
    otherExtnames?: string[]
}

export interface IFileTypeMap {
    [key: string]: IFileTypeInfo;
}

export const FileTypeMap: IFileTypeMap = {
    [FileType.raw]: { alias: '原图', extname: null, webType: null },
    [FileType.none]: { alias: '不使用', extname: null, webType: null },
    [FileType.avif]: { alias: 'avif', extname: '.avif', webType: 'image/avif' },
    [FileType.webp]: { alias: 'webp', extname: '.webp', webType: 'image/webp' },
    [FileType.jpeg]: { alias: 'jpeg', extname: '.jpeg', webType: 'image/jpeg', otherExtnames: ['.jpg'] },
    [FileType.png]: { alias: 'png', extname: '.png', webType: 'image/png' },
    [FileType.gif]: { alias: 'gif', extname: '.gif', webType: 'image/gif' }, // TODO
    [FileType.heif]: { alias: 'heif', extname: '.heif', webType: 'image/heif', otherExtnames: ['.heic'] }, // TODO
    [FileType.jxl]: { alias: 'jpeg-xl', extname: '.jxl', webType: 'image/jxl' }, // TODO
    [FileType.tiff]: { alias: 'tiff', extname: '.tiff', webType: 'image/tiff' } // TODO
}

export const getFileTypeFromExtname = (extname: string): FileType => {
    return Object.keys(FileType).find(p => FileTypeMap[p].extname == extname || FileTypeMap[p].otherExtnames?.includes(extname)) as FileType;
};

export enum OutputFormat {
    url = 'url', //* 返回原始url，只返回returnType指定的类型
    html = 'html', //* 启用<picture>标签形式的返回格式，需要在Picgo|PicList的返回链接格式里面选择url格式，并关闭url自动转义
    extra = 'extra' //* [仅PicList]，通过在output信息加入额外键记录压缩链接信息，配合Obsidian插件使用
}

export interface IConfig {
    firstFileType: FileType,
    secondFileType?: FileType,
    thirdFileType?: FileType,
    outputFormat: OutputFormat
    //whenSameType
    //hanleHdr
}