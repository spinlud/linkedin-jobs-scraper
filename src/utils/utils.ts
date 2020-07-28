const sleep = (ms: number): Promise<number> =>
    new Promise(resolve => setTimeout(resolve.bind(null, ms), ms));

export { sleep };
