// 브라우저 콘솔에 복사해서 실행하세요
// AI 생성 후 이 스크립트를 실행하면 마크 상태를 확인할 수 있습니다

console.log('=== 문서 마크 상태 디버깅 ===\n');

// 에디터 인스턴스 찾기
const editor = window.__TIPTAP_EDITOR__;
if (!editor) {
  console.error('에디터를 찾을 수 없습니다. __TIPTAP_EDITOR__ 변수가 설정되지 않았습니다.');
} else {
  let totalChars = 0;
  let markedChars = 0;
  let aiGeneratedChars = 0;

  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      totalChars += node.text.length;

      const textStateMark = node.marks.find(m => m.type.name === 'textState');

      if (textStateMark) {
        markedChars += node.text.length;

        console.log(`위치 ${pos}:`, {
          텍스트: node.text.slice(0, 30) + '...',
          state: textStateMark.attrs.state,
          roundId: textStateMark.attrs.roundId,
          마크개수: node.marks.length
        });

        if (textStateMark.attrs.state === 'ai-generated') {
          aiGeneratedChars += node.text.length;
        }
      } else {
        console.log(`위치 ${pos}: [마크 없음]`, node.text.slice(0, 30) + '...');
      }
    }
  });

  console.log('\n=== 요약 ===');
  console.log(`총 문자: ${totalChars}`);
  console.log(`마크된 문자: ${markedChars} (${Math.round(markedChars/totalChars*100)}%)`);
  console.log(`AI 생성 문자: ${aiGeneratedChars} (${Math.round(aiGeneratedChars/totalChars*100)}%)`);
  console.log(`마크 없는 문자: ${totalChars - markedChars} (${Math.round((totalChars-markedChars)/totalChars*100)}%)`);
}

// ContributionGraph 상태 확인
console.log('\n=== ContributionGraph 노드 ===');
const graphStore = window.useContributionGraphStore?.getState();
if (graphStore?.nodes) {
  console.log(`총 노드 수: ${graphStore.nodes.size}`);
  graphStore.nodes.forEach((node, roundId) => {
    console.log(`\n라운드 ${roundId}:`, {
      scores: node.scores,
      type: node.metadata.type,
      action: node.metadata.action,
      hasNarrative: node.narrative !== null
    });
  });
} else {
  console.log('ContributionGraph를 찾을 수 없습니다.');
}
