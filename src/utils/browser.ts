import { exec } from "child_process";

const killChromium = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        console.log("Killing Chromium processes");
        const cmd = "ps aux | grep -v grep | grep -i \"chromium\" | awk -F ' +' '{print $2}' | xargs kill -9 || :";
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return reject(err);
            }

            console.log(stdout);
            return resolve();
        });
    });
};

export {
    killChromium,
};
