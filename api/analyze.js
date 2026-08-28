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

// HTML(cheerio 객체)에서 "실제로 확인 가능한 사실"들을 뽑아낸다.
// 텍스트를 벗겨내기 전에 반드시 이걸 먼저 해야, AI가 추측이 아니라
// 진짜 데이터를 보고 소제목/이미지alt/링크 유무를 판단할 수 있다.
function extractStructure($) {
  // 1) 소제목(H1~H3) 목록
  const headings = [];
  $('h1, h2, h3').each((i, el) => {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) headings.push(`[${tag.toUpperCase()}] ${text}`);
  });
  const headingInfo = headings.length > 0
    ? `이 글에 실제로 존재하는 소제목 목록 (총 ${headings.length}개):\n${headings.join('\n')}`
    : '이 글에는 H1/H2/H3 소제목 태그가 하나도 없습니다. (실제로 확인된 사실입니다.)';

  // 2) 이미지 개수 및 alt(사진 설명 글) 존재 여부
  const images = $('img');
  const totalImages = images.length;
  let withAlt = 0;
  const altSamples = [];
  images.each((i, el) => {
    const alt = ($(el).attr('alt') || '').trim();
    if (alt) {
      withAlt++;
      if (altSamples.length < 5) altSamples.push(alt);
    }
  });
  let imageInfo;
  if (totalImages === 0) {
    imageInfo = '이 글에는 이미지가 하나도 없습니다. (실제로 확인된 사실입니다.)';
  } else {
    imageInfo = `이 글의 이미지 정보: 총 ${totalImages}개 중 ${withAlt}개에 사진 설명 글(alt)이 있습니다.` +
      (altSamples.length > 0 ? ` 실제 설명 글 예시: ${altSamples.map(a => `"${a}"`).join(', ')}` : '') +
      (withAlt < totalImages ? ` 나머지 ${totalImages - withAlt}개에는 설명 글이 없습니다.` : '');
  }

  // 3) 본문 안 링크(내부/외부) 개수
  const bodyLinks = $('p a, li a, article a').length;
  const linkInfo = bodyLinks > 0
    ? `본문 문단/리스트 안에 실제로 걸린 링크가 ${bodyLinks}개 있습니다. (실제로 확인된 사실입니다.)`
    : '본문 문단/리스트 안에는 링크가 하나도 없습니다. (블로그 하단의 "관련 글" 자동 목록과는 별개입니다.)';

  return { headingInfo, imageInfo, linkInfo };
}

// 순수 텍스트인지, HTML 태그가 섞여 있는지 간단히 판별
function looksLikeHtml(str) {
  return /<\s*[a-zA-Z][^>]*>/.test(str);
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
    let headingInfo = '';
    let imageInfo = '';
    let linkInfo = '';
    let structureKnown = false; // 실제 구조(소제목/이미지/링크)를 확인할 수 있었는지 여부

    if (type === 'url' && content) {
      const response = await axios.get(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      ownTitle = $('title').first().text().trim();

      const structure = extractStructure($);
      headingInfo = structure.headingInfo;
      imageInfo = structure.imageInfo;
      linkInfo = structure.linkInfo;
      structureKnown = true;

      $('script, style, nav, footer, header, iframe').remove();
      textToAnalyze = $('body').text().replace(/\s+/g, ' ').trim();

      if (textToAnalyze.length < 100) {
        return res.status(400).json({ error: '해당 URL에서 충분한 텍스트를 찾을 수 없습니다.' });
      }
    } else if (type === 'text' && content) {
      if (looksLikeHtml(content)) {
        // 사용자가 HTML 코드를 붙여넣은 경우 → URL 분석과 동일하게 실제 구조를 파싱
        const $ = cheerio.load(content);
        const titleTag = $('title').first().text().trim();
        const h1First = $('h1').first().text().trim();
        ownTitle = titleTag || h1First || '';

        const structure = extractStructure($);
        headingInfo = structure.headingInfo;
        imageInfo = structure.imageInfo;
        linkInfo = structure.linkInfo;
        structureKnown = true;

        $('script, style').remove();
        textToAnalyze = $.root().text().replace(/\s+/g, ' ').trim();
      } else {
        // 순수 텍스트만 붙여넣은 경우 → 구조 확인 불가, 단정하지 않도록 안내
        textToAnalyze = content;
        headingInfo = '(순수 텍스트만 입력되어 실제 소제목 태그 구조는 확인할 수 없습니다. 소제목 유무를 단정하지 말고, 필요하다면 "내용 흐름상 소제목으로 나누면 좋겠다" 정도로만 제안하세요.)';
        imageInfo = '(순수 텍스트만 입력되어 이미지나 사진 설명 글 여부는 확인할 수 없습니다. 이미지 관련 진단은 하지 마세요.)';
        linkInfo = '(순수 텍스트만 입력되어 링크 여부는 확인할 수 없습니다. 링크 관련 진단은 하지 마세요.)';
      }
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

내용 규칙 (가장 중요):
- "경쟁 글이 이렇다"처럼 실제 확인하지 않은 사실을 지어내지 마세요. 대신 "이런 글에서는 보통 ~~을 다루는 경우가 많아요" 같은 일반적 패턴에 근거해 말하세요.
- 뻔한 얘기(가독성 좋게 써라, 키워드 넣어라) 말고, 이 글의 실제 내용을 근거로 한 구체적 진단을 하세요.
- 점수는 후하게 주지 말고, 실제 컨설턴트처럼 냉정하게 평가하세요. 완벽한 글이 아닌 이상 90점 이상은 거의 주지 마세요.
- 사용자 메시지에 "소제목 정보", "이미지 정보", "링크 정보"가 실제로 확인된 사실로 함께 제공됩니다. 반드시 그대로 신뢰하고, 절대 이 사실과 다르게 말하지 마세요.
  - 소제목이 있다고 나오면 "소제목이 없다"고 말하지 말고, 대신 키워드가 잘 들어갔는지·개수가 충분한지를 평가하세요.
  - 이미지에 사진 설명 글(alt)이 이미 있다고 나오면 "사진 설명 글이 없다"고 말하지 마세요. 대신 그 설명 글이 사진 내용을 구체적으로 잘 담고 있는지, 부족한 나머지 이미지들에만 추가하라고 하세요.
  - 본문 링크가 있다고 나오면 "링크가 없다"고 말하지 말고, 그 개수가 충분한지만 언급하세요.
  - "확인할 수 없다"고 안내된 항목은 절대 단정하지 말고, 언급 자체를 생략하거나 "확인이 어려워 일반적인 조언만 드려요" 정도로만 다루세요.
- 내부링크(다른 글로 연결하는 링크)를 추천할 때는 절대로 "아무 글이나 연결하라"고 하지 마세요. 반드시 "이 글과 실제로 주제가 겹치는 글이 있을 때만" 자연스러운 문장 속에서 연결하라고 안내하세요. 관련 없는 글을 억지로 링크하면 오히려 방문자가 바로 이탈해서 역효과라는 점도 필요하면 짧게 언급하세요. 블로그 하단에 자동으로 뜨는 "관련 글" 목록과 본문 안 링크는 다르다는 것도 헷갈리지 않게 구분해서 말하세요 (본문 링크가 더 효과가 큽니다).

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
      `[소제목 정보]\n${headingInfo}\n\n` +
      `[이미지 정보]\n${imageInfo}\n\n` +
      `[링크 정보]\n${linkInfo}\n\n` +
      `[본문]\n${textToAnalyze}`;

    const analysisRaw = await callGroq(systemPrompt, userContent);
    const cleanJson = analysisRaw.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    // 참고용: 구조를 실제로 확인했는지 여부를 프론트엔드에도 함께 전달 (필요시 UI에 표시 가능)
    result.structure_known = structureKnown;

    return res.status(200).json(result);
  } catch (error) {
    console.error('Analysis Error:', error);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다: ' + error.message });
  }
}