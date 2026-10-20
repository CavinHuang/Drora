export const CLI_COMMAND_NAME = "drora";
export const CLI_PROCESS_NAME = "drora-cli";
export const setCliProcessTitle = (target = process) => {
    target.title = CLI_PROCESS_NAME;
};
