import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import MarkdownIt from 'markdown-it';

import type { Route } from '@/types';

const md = MarkdownIt({
    html: false,
    breaks: true,
    linkify: false,
});

const parseCSV = (content: string) => {
    const lines = content.trim().split('\n');
    if (lines.length < 1) {
        return [];
    }

    const headers = lines[0].split(',').map((h) => h.trim());
    return lines
        .slice(1)
        .filter((line) => line.trim() !== '')
        .map((line) => {
            const values = line.split(',').map((v) => v.trim() || '-');
            const record: Record<string, string> = {};

            for (const [index, header] of headers.entries()) {
                record[header] = values[index] || '-';
            }

            return record;
        });
};

// 检测轮动行情相关文件
const isTopCSV = (file: { isFile: () => boolean; name: string }) => file.isFile() && file.name.endsWith('.csv') && /^\d{8}_top_industry_stocks\.csv$/.test(file.name);

const isBottomCSV = (file: { isFile: () => boolean; name: string }) => file.isFile() && file.name.endsWith('.csv') && /^\d{8}_bottom_industry_stocks\.csv$/.test(file.name);

const isImage = (file: { isFile: () => boolean; name: string }) => file.isFile() && file.name.endsWith('.png') && /^\d{8}_industry_performance_trend\.png$/.test(file.name);

export const route: Route = {
    path: '/:directory{.+}',
    name: '轮动行情监控',
    maintainers: ['catlincao'],
    handler: async (ctx) => {
        const directory = ctx.req.param('directory');

        let files;
        try {
            files = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            ctx.status = 400;
            return {
                title: '读取失败',
                description: `无法读取目录: ${directory}，错误信息: ${(error as Error).message}`,
                item: [],
            };
        }

        // 获取所有相关文件
        const topFiles = files.filter((file) => isTopCSV(file));
        const bottomFiles = files.filter((file) => isBottomCSV(file));
        const imageFiles = files.filter((file) => isImage(file));

        if (topFiles.length === 0 || bottomFiles.length === 0) {
            return {
                title: '轮动行情监控',
                link: directory,
                description: '未找到符合规则的轮动行情CSV文件',
                item: [],
            };
        }

        // 按日期分组文件
        const filesByDate = new Map<
            string,
            {
                top: string;
                bottom: string;
                image: string | null;
            }
        >();

        // 处理领涨板块文件
        for (const file of topFiles) {
            const dateStr = file.name.slice(0, 8);
            filesByDate.set(dateStr, {
                ...(filesByDate.get(dateStr) || { top: '', bottom: '', image: null }),
                top: path.join(directory, file.name),
            });
        }

        // 处理高潜板块文件
        for (const file of bottomFiles) {
            const dateStr = file.name.slice(0, 8);
            if (filesByDate.has(dateStr)) {
                filesByDate.set(dateStr, {
                    ...filesByDate.get(dateStr)!,
                    bottom: path.join(directory, file.name),
                });
            }
        }

        // 处理图片文件
        for (const file of imageFiles) {
            const dateStr = file.name.slice(0, 8);
            if (filesByDate.has(dateStr)) {
                filesByDate.set(dateStr, {
                    ...filesByDate.get(dateStr)!,
                    image: path.join(directory, file.name),
                });
            }
        }

        // 筛选出完整的轮动行情数据（同时有领涨和高潜板块）
        const validRotationData = [...filesByDate.entries()].filter(([_, files]) => files.top && files.bottom).toSorted(([dateA], [dateB]) => dateB.localeCompare(dateA)); // 按日期倒序

        if (validRotationData.length === 0) {
            return {
                title: '轮动行情监控',
                link: directory,
                description: '未找到完整的轮动行情数据',
                item: [],
            };
        }

        // 生成RSS items
        const items = await Promise.all(
            validRotationData.map(async ([dateStr, files]) => {
                // 解析日期
                let date;
                try {
                    date = new Date(Number.parseInt(dateStr.slice(0, 4)), Number.parseInt(dateStr.slice(4, 6)) - 1, Number.parseInt(dateStr.slice(6, 8)));
                    if (Number.isNaN(date.getTime())) {
                        throw new TypeError('无效日期');
                    }
                } catch {
                    date = new Date();
                }

                // 读取领涨板块数据
                const topContent = await readFile(files.top, 'utf-8');
                const topRecords = parseCSV(topContent);

                // 读取高潜板块数据
                const bottomContent = await readFile(files.bottom, 'utf-8');
                const bottomRecords = parseCSV(bottomContent);

                // 获取行业名称（取第一个记录的行业）
                const topIndustry = topRecords[0]?.industry || '未知行业';
                const bottomIndustry = bottomRecords[0]?.industry || '未知行业';

                // 生成Markdown内容
                let mdContent = `# 轮动行情监控\n\n`;
                mdContent += `> 📅 日期：${dateStr}\n\n`;

                // 当日领涨板块
                mdContent += `## 📈 当日领涨板块：${topIndustry}\n\n`;
                mdContent += `### 📋 股票列表\n\n`;
                for (const [index, record] of topRecords.entries()) {
                    mdContent += `${index + 1}. **${record.name}** (${record.ts_code})\n`;
                }
                mdContent += `\n`;

                // 当日高潜板块
                mdContent += `## 📊 当日高潜板块：${bottomIndustry}\n\n`;
                mdContent += `### 📋 股票列表\n\n`;
                for (const [index, record] of bottomRecords.entries()) {
                    mdContent += `${index + 1}. **${record.name}** (${record.ts_code})\n`;
                }
                mdContent += `\n`;

                // 插入图表
                mdContent += `## 📉 行业表现趋势

`;
                if (files.image) {
                    // 提取图片文件名，使用完整的绝对路径
                    const imageFileName = path.basename(files.image);
                    // 使用完整的绝对路径，包括协议和主机名
                    const imageUrl = `${process.env.ROTATION_IMAGE_BASE_URL || 'http://localhost:1200/rotation-images'}/${imageFileName}`;
                    mdContent += `![行业表现趋势](${imageUrl})

`;
                } else {
                    mdContent += `> 暂无行业表现趋势图表

`;
                }

                const htmlDescription = md.render(mdContent);

                return {
                    title: `${dateStr} 轮动行情监控`,
                    description: htmlDescription,
                    pubDate: date,
                    category: ['rotation', 'stock'],
                };
            })
        );

        return {
            title: '轮动行情监控',
            link: directory,
            description: '每日轮动行情监控，包括领涨板块和高潜板块数据',
            item: items,
        };
    },
    example: '/rotation-monitor//path/to/rotation/files',
    parameters: {
        directory: '轮动行情文件所在目录的绝对路径',
    },
};
