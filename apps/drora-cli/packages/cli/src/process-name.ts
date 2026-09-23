export const CLI_COMMAND_NAME = "drora";
export const CLI_PROCESS_NAME = "drora-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
