const CDP = require('chrome-remote-interface');

const LOGIN_URL =
'https://sp.srmist.edu.in/srmiststudentportal/students/loginManager/youLogin.jsp';

(async () => {
    let client;

    try {
        client = await CDP({
            host: '127.0.0.1',
            port: 9222
        });

        const { Page, Runtime } = client;

        await Page.enable();
        await Runtime.enable();

        console.log('Connected to Android Chromium!');
        console.log('Opening SRM login portal...');

        await Page.navigate({ url: LOGIN_URL });

        await new Promise(resolve => setTimeout(resolve, 8000));

        const result = await Runtime.evaluate({
            expression: `({
                title: document.title,
                url: location.href,
                ready: document.readyState
            })`,
            returnByValue: true
        });

        console.log('Page title:', result.result.value.title);
        console.log('Current URL:', result.result.value.url);
        console.log('Page state:', result.result.value.ready);

        console.log('Mobile browser test completed!');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (client) await client.close();
    }
})();
