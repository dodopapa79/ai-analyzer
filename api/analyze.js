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

    if (type === 'url' && content) {
      const response = await axios.get(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      ownTitle = $('title').first().text().trim();

      $('script, style, nav, footer, header, iframe').remove();
      textToAnalyze = $('body').text().replace(/\s+/g, ' ').trim();

      if (textToAnalyze.length < 100) {
        return res.status(400).json({ error: '해당 URL에서 충분한 텍스트를 찾을 수 없습니다.' });
      }
    } else if (type === 'text' && content) {
      textToAnalyze = content;
    } else {
      return res.status(400).json({ error: 'type과 content가 필요합니다.' });
    }

    textToAnalyze = textToAnalyze.substring(0, 4000);

    const systemPrompt = `당신은 15년 경력의 SEO 컨설턴트입니다. 글쓴이는 이미 자기 글의 요약, 제목, 키워드를 알고 있으므로 그런 내용은 절대 반복하지 마세요.
실시간 검색 데이터는 없지만, 당신은 이런 종류의 주제(리뷰, 정보성 글, 여행기, 제품 소개 등)가 검색 상위에 오르려면 통상적으로 어떤 요소를 갖춰야 하는지에 대한 폭넓은 지식이 있습니다. 그 지식을 바탕으로 이 글을 진단하세요.

주의사항:
- "경쟁 글이 이렇다"처럼 실제 확인하지 않은 사실을 지어내지 마세요. 대신 "이런 유형의 글에서는 보통 ~~을 다루는 경우가 많습니다" 같은 일반적 패턴에 근거해 말하세요.
- 뻔한 얘기(가독성 좋게 써라, 키워드 넣어라) 말고, 이 글의 실제 내용을 근거로 한 구체적 진단을 하세요.
- 점수는 후하게 주지 말고, 실제 컨설턴트처럼 냉정하게 평가하세요. 완벽한 글이 아닌 이상 90점 이상은 거의 주지 마세요.

정확히 아래 JSON 형식으로만, 마크다운 코드블록 없이 순수 JSON으로 답변하세요:
{
  "score": 0~100 사이의 정수 (이 글이 검색 상위 노출 관점에서 얼마나 잘 갖춰져 있는지 종합 점수),
  "score_reason": "이 점수를 준 핵심 이유 한 문장",
  "topic_type": "이 글의 주제 유형 (예: 제품 리뷰, 여행 후기, 정보성 가이드 등)",
  "weaknesses": ["이 글의 구조/내용상 약점 2~3가지. 왜 검색 상위 노출에 불리한지 구체적으로"],
  "missing_topics": ["이런 유형의 글이라면 보통 다루는데 이 글에는 없는 내용 2~3가지. 왜 필요한지 이유와 함께"],
  "title_diagnosis": "현재 제목(또는 글의 주제 표현 방식)의 SEO적 약점과, 그것을 보완한 대안 제목 1개 + 이유",
  "meta_suggestion": "글 서두 내용을 바탕으로 실제 클릭을 유도할 메타 디스크립션 1개 (160자 이내) + 왜 이게 더 나은지 이유",
  "action_items": ["지금 바로 수정하면 검색 노출에 효과 있을 구체적 실행 항목 3가지"]
}`;

    const userContent = (ownTitle ? `[제목]\n${ownTitle}\n\n[본문]\n` : '') + textToAnalyze;
    const analysisRaw = await callGroq(systemPrompt, userContent);
    const cleanJson = analysisRaw.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Analysis Error:', error);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다: ' + error.message });
  }
}