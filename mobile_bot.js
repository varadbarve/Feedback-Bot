
const CDP = require('chrome-remote-interface');
const readline = require('readline');
const fs = require('fs');

const LOGIN_URL =
'https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp';

const RATING = 'EXCELLENT';

// Keep actual submissions disabled during the first test.
// Set SUBMIT=1 in Termux when ready.
const SUBMIT = process.env.SUBMIT === '1';

function loadEnv() {
    if (!fs.existsSync('.env')) return {};

    const values = {};

    fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
        const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
        if (match) {
            values[match[1].trim()] =
                match[2].trim().replace(/^["']|["']$/g, '');
        }
    });

    return values;
}

const env = loadEnv();

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

async function main() {
    let client;

    try {
        client = await CDP({
            host: '127.0.0.1',
            port: 9222
        });

        const { Page, Runtime } = client;

        await Page.enable();
        await Runtime.enable();

        // Preserve the original automatic confirmation behaviour.
        Page.javascriptDialogOpening(async () => {
            await Page.handleJavaScriptDialog({
                accept: true
            });
        });

        async function evaluate(expression, args = []) {
            const result = await Runtime.evaluate({
                expression,
                arguments: args.map(value => ({
                    value
                })),
                returnByValue: true,
                awaitPromise: true
            });

            if (result.exceptionDetails) {
                throw new Error(
                    result.exceptionDetails.text || 'Browser evaluation failed'
                );
            }

            return result.result.value;
        }

        console.log('\nConnected to Android Chromium.');

        const pages = await Page.getFrameTree();

        console.log('Current browser page connected.');

        await Page.navigate({ url: LOGIN_URL });
        await wait(5000);

        // Auto-fill credentials when available.
        const username = process.env.SRM_USERNAME || env.SRM_USERNAME || '';
        const password = process.env.SRM_PASSWORD || env.SRM_PASSWORD || '';

        if (username && password) {
            await evaluate(`
                (() => {
                    const u = document.querySelector('#username');
                    const p = document.querySelector('#password');

                    if (!u || !p) return false;

                    u.removeAttribute('maxlength');

                    const setValue = (el, value) => {
                        const setter = Object.getOwnPropertyDescriptor(
                            HTMLInputElement.prototype, 'value'
                        ).set;

                        setter.call(el, value);
                        el.dispatchEvent(new Event('input', {bubbles:true}));
                        el.dispatchEvent(new Event('change', {bubbles:true}));
                    };

                    setValue(u, arguments[0]);
                    setValue(p, arguments[1]);

                    return true;
                })()
            `, [username, password]);

            console.log('Credentials filled.');
        } else {
            console.log('Credentials not configured. Enter them manually.');
        }

        console.log('\nSolve CAPTCHA and log in manually.');

        await ask('Press ENTER after successful login...');

        let state = await evaluate(`({
            url: location.href,
            title: document.title
        })`);

        console.log('Current page:', state.url);

        if (state.url.toLowerCase().includes('login')) {
            console.log('Still on login page. Stopping.');
            return;
        }

        console.log('\nLooking for End Sem Feedback...');

        const clicked = await evaluate(`
            (() => {
                const links = [...document.querySelectorAll('a')];

                const link = links.find(a => {
                    const text = a.innerText.trim().toLowerCase();
                    return text.includes('end sem') ||
                           text.includes('feedback');
                });

                if (!link) return false;

                link.click();
                return true;
            })()
        `);

        if (!clicked) {
            console.log('Feedback link not found automatically.');
            await ask('Open End Sem Feedback manually, then press ENTER...');
        }

        await wait(4000);

        const subjects = await evaluate(`
            (() => {
                const select = document.querySelector('select');
                if (!select) return [];

                return [...select.options].map((option, index) => ({
                    index,
                    text: option.textContent.trim()
                }));
            })()
        `);

        console.log('\nAvailable subjects:');

        subjects.forEach(subject => {
            console.log(`[${subject.index}] ${subject.text}`);
        });

        if (!subjects.length) {
            console.log('No subject dropdown found. Stopping.');
            return;
        }

        let submitted = 0;
        let skipped = 0;

        for (const subject of subjects) {
            const name = subject.text;

            if (!name || [
                'select',
                '--select--',
                '-- select --',
                'select subject'
            ].includes(name.toLowerCase())) {
                continue;
            }

            console.log('\n' + '='.repeat(45));
            console.log('Subject:', name);

            const filled = await evaluate(`
                (async () => {
                    const subject = document.querySelector('select');
                    if (!subject) return 0;

                    subject.selectedIndex = arguments[0];

                    subject.dispatchEvent(
                        new Event('input', {bubbles:true})
                    );

                    subject.dispatchEvent(
                        new Event('change', {bubbles:true})
                    );

                    await new Promise(resolve =>
                        setTimeout(resolve, 2000)
                    );

                    let count = 0;

                    for (const select of document.querySelectorAll('select')) {
                        if (select === subject) continue;

                        const options = [...select.options];

                        const hasRating = options.some(option =>
                            /excellent|good|average|poor|very good|satisfactory/i
                                .test(option.textContent)
                        );

                        if (!hasRating) continue;

                        const match = options.find(option =>
                            option.textContent.toLowerCase()
                                .includes('excellent')
                        );

                        if (!match) continue;

                        select.value = match.value;

                        select.dispatchEvent(
                            new Event('input', {bubbles:true})
                        );

                        select.dispatchEvent(
                            new Event('change', {bubbles:true})
                        );

                        count++;
                    }

                    return count;
                })()
            `.replace('arguments[0]', String(subject.index)));

            console.log('Rating fields filled:', filled);

            if (!filled) {
                console.log('No rating fields found. Skipping.');
                skipped++;
                continue;
            }

            // Match the original submission selector order.
            const submitInfo = await evaluate(`
                (() => {
                    const selectors = ['#cmdSave',
                        'input[type="submit"]',
                        'button[type="submit"]',
                        'input[value="Submit"]',
                        'input[value="SUBMIT"]',
                        'input[value="submit"]',
                        'input[type="button"][value="Submit"]',
                        'input[type="button"][value="SUBMIT"]'
                    ];

                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (el) {
                            return {
                                found: true,
                                selector,
                                text: el.innerText ||
                                      el.value || selector
                            };
                        }
                    }

                    const buttons = [...document.querySelectorAll('button')];

                    const button = buttons.find(el =>
                        /submit/i.test(el.innerText)
                    );

                    if (button) {
                        return {
                            found: true,
                            selector: 'button',
                            text: button.innerText.trim()
                        };
                    }

                    const links = [...document.querySelectorAll('a')];

                    const link = links.find(el =>
                        /submit/i.test(el.innerText)
                    );

                    if (link) {
                        return {
                            found: true,
                            selector: 'a',
                            text: link.innerText.trim()
                        };
                    }

                    return {found: false};
                })()
            `);

            if (!submitInfo.found) {
                console.log('Submission control not identified. Stopping.');
                skipped++;
                break;
            }

            console.log('Submission control:', submitInfo.text);

            if (!SUBMIT) {
                console.log('DRY RUN: Ratings filled, not submitted.');
                skipped++;
                continue;
            }

            const result = await evaluate(`
                (() => {
                    const info = arguments[0];

                    let el = null;

                    if (info.selector === 'button') {
                        el = [...document.querySelectorAll('button')]
                            .find(e => /submit/i.test(e.innerText));
                    } else if (info.selector === 'a') {
                        el = [...document.querySelectorAll('a')]
                            .find(e => /submit/i.test(e.innerText));
                    } else {
                        el = document.querySelector(info.selector);
                    }

                    if (!el) return false;

                    el.click();
                    return true;
                })()
            `.replace('arguments[0]', JSON.stringify(submitInfo)));

            if (result) {
                await wait(3000);
                console.log('Submit action triggered.');
                submitted++;
            } else {
                console.log('Submit control disappeared.');
                skipped++;
            }
        }

        console.log('\n' + '='.repeat(45));
        console.log('Automation finished.');
        console.log('Submitted:', submitted);
        console.log('Skipped:', skipped);
        console.log('='.repeat(45));

    } catch (error) {
        console.error('\nBOT ERROR:', error.message);
    } finally {
        if (client) await client.close();
    }
}

main();

