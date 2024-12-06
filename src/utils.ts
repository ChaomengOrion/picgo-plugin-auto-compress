// 参考Picgo-Core

import { readFile } from 'fs-extra'
import path from 'path'
import { imageSize } from 'image-size'
import { URL } from 'url'

import {
    IPathTransformedImgInfo,
    IPicGo
} from 'picgo'

import { IImgSize } from './interfaces'

export const isUrl = (url: string): boolean => /^https?:\/\//.test(url)

export const isUrlEncode = (url: string): boolean => {
    url = url || ''
    try {
        // the whole url encode or decode shold not use encodeURIComponent or decodeURIComponent
        return url !== decodeURI(url)
    } catch (e) {
        return false
    }
}

export const handleUrlEncode = (url: string): string => {
    if (!isUrlEncode(url)) {
        url = encodeURI(url)
    }
    return url
}

export const getImageSize = (file: Buffer): IImgSize => {
    try {
        const { width = 0, height = 0, type } = imageSize(file)
        const extname = type ? `.${type}` : '.png'
        return {
            real: true,
            width,
            height,
            extname
        }
    } catch (e) {
        // fallback to 200 * 200
        return {
            real: false,
            width: 200,
            height: 200,
            extname: '.png'
        }
    }
}

export const getFSFile = async (filePath: string): Promise<IPathTransformedImgInfo> => {
    try {
        return {
            extname: path.extname(filePath),
            fileName: path.basename(filePath),
            buffer: await readFile(filePath),
            success: true
        }
    } catch {
        return {
            reason: `read file ${filePath} error`,
            success: false
        }
    }
}

export const getURLFile = async (url: string, ctx: IPicGo): Promise<IPathTransformedImgInfo> => {
    url = handleUrlEncode(url)
    let timeoutId: NodeJS.Timeout
    const requestFn = new Promise<IPathTransformedImgInfo>((resolve, reject) => {
        ; (async () => {
            try {
                const res = await ctx
                    .request({
                        method: 'get',
                        url,
                        resolveWithFullResponse: true,
                        responseType: 'arraybuffer'
                    })
                    .then(resp => {
                        return resp.data as Buffer
                    })
                clearTimeout(timeoutId)
                const urlPath = new URL(url).pathname
                let extname = ''
                try {
                    const urlParams = new URL(url).searchParams
                    extname = urlParams.get('wx_fmt') || path.extname(urlPath) || ''
                } catch (error) {
                    extname = path.extname(urlPath) || ''
                }
                if (!extname.startsWith('.') && extname) {
                    extname = `.${extname}`
                }
                resolve({
                    buffer: res,
                    fileName: path.basename(urlPath),
                    extname,
                    success: true
                })
            } catch (error: any) {
                clearTimeout(timeoutId)
                resolve({
                    success: false,
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    reason: `request ${url} error, ${error?.message ?? ''}`
                })
            }
        })().catch(reject)
    })
    const timeoutPromise = new Promise<IPathTransformedImgInfo>((resolve): void => {
        timeoutId = setTimeout(() => {
            resolve({
                success: false,
                reason: `request ${url} timeout`
            })
        }, 30000)
    })
    return Promise.race([requestFn, timeoutPromise])
}

export const getImgSize = (ctx: IPicGo, file: Buffer, path: string | Buffer): IImgSize => {
    const imageSize = getImageSize(file)
    if (!imageSize.real) {
        if (typeof path === 'string') {
            ctx.log.warn(`can't get ${path}'s image size`)
        } else {
            ctx.log.warn("can't get image size")
        }
        ctx.log.warn('fallback to 200 * 200')
    }
    return imageSize
}