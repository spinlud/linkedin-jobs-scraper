export const normalizeString = (s: string): string => {
    return s.replace(/[\n\r\t ]+/g, ' ').trim();
}
