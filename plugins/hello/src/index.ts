/**
 * node 半：什么都不做。
 * 这个件的全部内容在浏览器那半（src/client），node 这半只是让 loader 挂得上——
 * 挂上了它才会出现在条目表里，渲染层才认得出它是外壳。
 */
export const name = 'gwb-hello'

export function apply(): void {}
