#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

const NUMERIC_MD_FILE = /^(\d+)-.+\.md$/i;
const SKIP_PREFIXES = new Set(['00']);
const OUTPUT_FILE_NAME = 'prompt.md';

function usage() {
    return [
        'Usage: node scripts/prompt-concat.js <directory>',
        '',
        'Example:',
        '  node scripts/prompt-concat.js ./lovable-integration/subscription-access',
    ].join('\n');
}

function compareNumericFiles(a, b) {
    const [, aNum] = a.match(NUMERIC_MD_FILE) || [];
    const [, bNum] = b.match(NUMERIC_MD_FILE) || [];

    const aValue = Number.parseInt(aNum, 10);
    const bValue = Number.parseInt(bNum, 10);

    if (aValue !== bValue) return aValue - bValue;
    return a.localeCompare(b);
}

async function run() {
    const targetArg = process.argv[2];

    if (!targetArg) {
        console.error(usage());
        process.exit(1);
    }

    const spinner = ora({
        text: 'Resolving directory...',
        color: 'cyan',
    }).start();

    try {
        const directory = path.resolve(targetArg);

        const stat = await fs.stat(directory).catch(() => null);
        if (!stat || !stat.isDirectory()) {
            spinner.fail(chalk.red(`Directory does not exist: ${directory}`));
            process.exit(1);
        }

        spinner.text = 'Scanning markdown files...';
        const entries = await fs.readdir(directory, { withFileTypes: true });

        const files = entries
            .filter(
                (entry) => entry.isFile() && NUMERIC_MD_FILE.test(entry.name)
            )
            .map((entry) => entry.name)
            .filter((file) => {
                const [, numericPrefix] = file.match(NUMERIC_MD_FILE) || [];
                return !SKIP_PREFIXES.has(numericPrefix);
            })
            .sort(compareNumericFiles);

        if (files.length === 0) {
            spinner.fail(
                chalk.yellow(
                    `No matching files found in ${directory} (expected names like 00-*.md, 01-*.md).`
                )
            );
            process.exit(1);
        }

        spinner.text = `Reading ${files.length} file(s)...`;
        const chunks = [];

        for (const file of files) {
            const fullPath = path.join(directory, file);
            const content = await fs.readFile(fullPath, 'utf8');
            chunks.push(content.trimEnd());
        }

        spinner.text = 'Writing output file...';
        const outputPath = path.join(directory, OUTPUT_FILE_NAME);
        await fs.writeFile(outputPath, `${chunks.join('\n\n')}\n`, 'utf8');

        spinner.succeed(chalk.green(`Created ${outputPath}`));
        console.log(chalk.bold('Files merged (in order):'));
        for (const file of files) {
            console.log(chalk.gray(`  - ${file}`));
        }
    } catch (error) {
        spinner.fail(chalk.red('Failed to build integration prompt.'));
        console.error(
            chalk.red(error instanceof Error ? error.message : String(error))
        );
        process.exit(1);
    }
}

run();
