import { IImgInfo } from "picgo"
import { FileTypeForSharp } from "./config"

export interface IImgSize {
    width: number
    height: number
    real?: boolean
    extname?: string
}

export interface ITransformInfo {
    newFileName: string
    newExtname: string
    toFormat: FileTypeForSharp
}

export interface ICustomImgInfo extends IImgInfo {
    _isSubImage?: boolean
    _packInfo?: ITransformInfo[]
    _sourceFileName?: string
}

export interface IPackImgInfo extends IImgInfo {
    _packInfo: {
        imageList: {
            imgUrl: string
            imgWebType: string
        }[]
        sourceImageUrl: string
    }
}