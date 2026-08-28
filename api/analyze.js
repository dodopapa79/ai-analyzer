import axios from 'axios';
import * as cheerio from 'cheerio';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAIN_MODEL = 'openai/gpt-oss-120b';

async function callGroq(systemPrompt, userContent, temperature = 0.4) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MAIN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature
    })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq 응답 오류: ' + (data.error?.message || JSON.stringify(data)));
  }
  return data.choices[0].message.content;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (e) { return res.status(400).json({ error: '잘못된 요청 형식입니다.' }); }
    }

    const { type, content } = body || {};
    let textToAnalyze = '';
    let ownTitle = '';
    let headingInfo = ''; // AI에게 전달할 "실제 소제목 구조" 정보 (있으면 URL 분석 시에만 채워짐)

    if (type === 'url' && content) {
      const response = await axios.get(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      ownTitle = $('title').first().text().trim();

      // 본문 텍스트를 벗기기 "전"에, 실제 존재하는 소제목(H1~H3) 목록을 먼저 뽑아둔다.
      // 이렇게 안 하면 태그가 다 벗겨진 뒤에는 AI가 "소제목이 있는지 없는지" 알 방법이 없어져서,
      // 실제로는 소제목이 있어도 "없다"고 잘못 진단하는 문제가 생긴다.
      const headings = [];
      $('h1, h2, h3').each((i, el) => {
        const tag = el.tagName.toLowerCase();
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text) headings.push(`[${tag.toUpperCase()}] ${text}`);
      });
      headingInfo = headings.length > 0
        ? `이 글에 실제로 존재하는 소제목 목록 (총 ${headings.length}개):\n${headings.join('\n')}`
        : '이 글에는 H1/H2/H3 소제목 태그가 하나도 없습니다. (이건 실제로 확인된 사실입니다.)';

      $('script, style, nav, footer, header, iframe').remove();
      textToAnalyze = $('body').text().replace(/\s+/g, ' ').trim();

      if (textToAnalyze.length < 100) {
        return res.status(400).json({ error: '해당 URL에서 충분한 텍스트를 찾을 수 없습니다.' });
      }
    } else if (type === 'text' && content) {
      textToAnalyze = content;
      headingInfo = '(텍스트 직접 입력 방식이라 실제 소제목 태그 구조는 확인할 수 없습니다. 소제목 유무를 단정하지 말고, 필요하다면 "내용 흐름상 소제목으로 나누면 좋겠다" 정도로만 제안하세요.)';
    } else {
      return res.status(400).json({ error: 'type과 content가 필요합니다.' });
    }

    textToAnalyze = textToAnalyze.substring(0, 4000);

    const systemPrompt = `당신은 블로그를 이제 막 시작한 완전 초보자에게, 친절한 옆자리 선배처럼 쉽게 설명해주는 SEO 컨설턴트입니다.
글쓴이는 SEO 전문 용어를 전혀 모른다고 가정하세요. 실시간 검색 데이터는 없지만, 당신은 이런 종류의 주제(리뷰, 정보성 글, 여행기, 제품 소개 등)가 검색 상위에 오르려면 통상적으로 어떤 요소를 갖춰야 하는지에 대한 폭넓은 지식이 있습니다. 그 지식을 바탕으로 이 글을 진단하세요.

말투/용어 규칙 (반드시 지키세요):
- 전문 용어를 절대 그냥 던지지 마세요. 아래처럼 쉬운 말로 바꾸거나, 꼭 써야 한다면 바로 뒤에 괄호로 아주 쉽게 풀어써주세요.
  예: "헤딩 구조" → "소제목(H2, H3 같은 큰 제목)", "스키마 마크업" → 아예 언급하지 말고 "구글에 내 글의 종류를 알려주는 설정" 정도로 순화하거나 생략, "ALT 텍스트" → "사진 설명 글(사진에 붙이는 짧은 설명)", "리치 스니펫" → "검색결과에 사진이나 별점이 같이 뜨는 것", "페이지 권위" → "내 블로그가 얼마나 믿을만해 보이는지", "체류 시간" → "방문자가 오래 머무는 것", "메타 디스크립션" → "검색결과 미리보기 글", "내부링크" → "내 블로그의 다른 글로 연결하는 링크", "E-A-T" 같은 약어는 절대 쓰지 마세요.
- 초등학생도 이해할 수준의 짧고 쉬운 문장으로 쓰세요. 한 문장에 어려운 개념 하나만 담으세요.
- "~해야 합니다" 같은 딱딱한 말투보다, "~하면 좋아요", "~해보세요" 처럼 친근하게 쓰세요.
- 그렇다고 내용을 얕게 만들지는 마세요. 쉬운 말로 풀되, 이 글의 실제 내용을 근거로 한 구체적인 진단은 유지하세요.

내용 규칙:
- "경쟁 글이 이렇다"처럼 실제 확인하지 않은 사실을 지어내지 마세요. 대신 "이런 글에서는 보통 ~~을 다루는 경우가 많아요" 같은 일반적 패턴에 근거해 말하세요.
- 뻔한 얘기(가독성 좋게 써라, 키워드 넣어라) 말고, 이 글의 실제 내용을 근거로 한 구체적 진단을 하세요.
- 점수는 후하게 주지 말고, 실제 컨설턴트처럼 냉정하게 평가하세요. 완벽한 글이 아닌 이상 90점 이상은 거의 주지 마세요.
- 아주 중요: 사용자 메시지에 "이 글에 실제로 존재하는 소제목 목록"이 함께 제공됩니다. 이건 실제로 확인된 사실이니 반드시 그대로 신뢰하세요.
  - 목록에 소제목이 있으면 "소제목이 없다"고 절대 말하지 마세요. 대신 그 소제목들이 검색에 유리한 키워드를 담고 있는지, 개수가 충분한지, 내용을 잘 요약하는지를 평가하세요.
  - 목록이 "없다"고 나오면 그때만 소제목 부재를 지적하세요.
  - 텍스트 직접 입력이라 확인이 불가능하다고 안내된 경우엔, 소제목 유무를 절대 단정하지 마세요.

정확히 아래 JSON 형식으로만, 마크다운 코드블록 없이 순수 JSON으로 답변하세요:
{
  "score": 0~100 사이의 정수 (이 글이 검색 상위 노출 관점에서 얼마나 잘 갖춰져 있는지 종합 점수),
  "score_reason": "이 점수를 준 핵심 이유 한 문장 (쉬운 말로)",
  "topic_type": "이 글의 주제 유형 (예: 제품 리뷰, 여행 후기, 정보성 가이드 등)",
  "weaknesses": ["이 글의 약점 2~3가지. 쉬운 말로, 왜 검색에 불리한지 구체적으로"],
  "missing_topics": ["이런 글이라면 보통 다루는데 이 글에는 없는 내용 2~3가지. 왜 있으면 좋은지 쉬운 말로"],
  "title_diagnosis": "현재 제목의 아쉬운 점과, 그것을 보완한 대안 제목 1개 + 이유 (쉬운 말로)",
  "meta_suggestion": "글 서두 내용을 바탕으로 만든 검색결과 미리보기 글 1개 (160자 이내) + 왜 이게 더 나은지 이유 (쉬운 말로)",
  "action_items": ["지금 바로 수정하면 좋을 구체적 실행 항목 3가지. 쉬운 말로, 초보자도 바로 따라할 수 있게"]
}`;

    const userContent =
      (ownTitle ? `[제목]\n${ownTitle}\n\n` : '') +
      `[${headingInfo}]\n\n` +
      `[본문]\n${textToAnalyze}`;
    const analysisRaw = await callGroq(systemPrompt, userContent);
    const cleanJson = analysisRaw.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Analysis Error:', error);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다: ' + error.message });
  }
}