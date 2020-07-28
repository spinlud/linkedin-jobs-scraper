interface IStates {
    notInitialized: string;
    initializing: string;
    initialized: string;
}

const states: IStates = {
    notInitialized: "notInitialized",
    initializing: "initializing",
    initialized: "initialized",
};

export { states };
