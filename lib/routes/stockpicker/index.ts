import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Route } from '@/types';

// 简单的CSV解析函数
const parseCSV = (content: string) => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());

    return lines
        .slice(1)
        .filter((line) => line.trim() !== '')
        .map((line) => {
            const values = line.split(',').map((v) => v.trim());
            const record: Record<string, string> = {};

            for (const [index, header] of headers.entries()) {
                record[header] = values[index] || '';
            }

            return record;
        });
};

export const route: Route = {
    path: '/:directory{.+}',
    name: 'Stock Picker',
    maintainers: ['catlincao'],
    handler: async (ctx) => {
        const directory = ctx.req.param('directory');

        // 读取目录下的所有文件
        const files = await readdir(directory, { withFileTypes: true });

        // 过滤出符合命名规则的CSV文件
        const stockFiles = files.filter((file) => file.isFile() && file.name.endsWith('.csv')).filter((file) => /^\d{8}_\w+_selected_stocks\.csv$/.test(file.name));

        // 按时间排序（最新的在前）
        stockFiles.sort((a, b) => {
            const dateA = a.name.slice(0, 8);
            const dateB = b.name.slice(0, 8);
            return dateB.localeCompare(dateA);
        });

        // 并行处理所有文件
        const items = await Promise.all(
            stockFiles.map(async (file) => {
                const filePath = path.join(directory, file.name);
                const fileContent = await readFile(filePath, 'utf-8');

                // 解析CSV内容
                const records = parseCSV(fileContent);

                // 提取文件名信息
                const [dateStr, type] = file.name.split('_', 2);
                const date = new Date(Number.parseInt(dateStr.slice(0, 4)), Number.parseInt(dateStr.slice(4, 6)) - 1, Number.parseInt(dateStr.slice(6, 8)));

                // 格式化类型名称
                const formattedType = type.replace('_', ' ').replace(/^./, (str) => str.toUpperCase());

                // 生成该CSV文件的描述，包含所有股票信息
                let description = `### ${formattedType} 选股结果\n\n`;
                description += `**日期**: ${dateStr}\n`;
                description += `**选股数量**: ${records.length}只\n\n`;

                // 为每个股票生成一行信息
                for (const [index, record] of records.entries()) {
                    const { ts_code, target_weight, name, industry, pe, pe_percentile } = record;
                    description += `${index + 1}. **${name}** (${ts_code})\n`;
                    description += `   - 所属行业: ${industry}\n`;
                    description += `   - 选股权重: ${target_weight}\n`;
                    if (pe) {
                        description += `   - PE: ${pe}\n`;
                    }
                    if (pe_percentile) {
                        description += `   - PE百分位: ${pe_percentile}\n`;
                    }
                    description += '\n';
                }

                // 生成该CSV文件的RSS条目
                return {
                    title: `${dateStr} ${formattedType} 选股结果`,
                    description,
                    pubDate: date,
                    category: [type],
                };
            })
        );

        return {
            title: '每日选股数据',
            link: directory,
            description: '每日选股数据RSS源',
            item: items,
        };
    },
    example: '/stockpicker//path/to/csv/files',
    parameters: {
        directory: 'CSV文件所在目录的绝对路径',
    },
};
