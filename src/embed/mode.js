export const embedded = new URLSearchParams(location.search).get('embed') === '1';
export const buildCommit = typeof __PIKADO_COMMIT__ === 'string' ? __PIKADO_COMMIT__ : 'development';

export function partitionName(userId, projectId) {
  if (![userId, projectId].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
    throw new Error('用户或项目标识无效');
  }
  return `pikado:vbd:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}
