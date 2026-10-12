export function validGitSourcePath(path) {
  if (typeof path !== 'string' || !path || /[\\:\x00-\x1f\x7f]/.test(path)) return false;
  return path.split('/').every(segment =>
    segment && segment !== '.' && segment !== '..' && segment.trim() === segment);
}
