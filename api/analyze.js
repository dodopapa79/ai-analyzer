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
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
      }
    }

    const { type, content } = body || {};
    let textToAnalyze = '';

    if (type === 'url' && content) {
      const axios = (await import('axios')).default;
      const cheerio = await import('cheerio');

      const response = await axios.get(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
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

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b', // ✅ 여기가 핵심 수정 포인트
        messages: [
          {
            role: 'system',
            content: `다음 텍스트를 분석하여 정확히 아래 JSON 형식으로만 답변하세요. (마크다운 코드 블록 사용하지 말고 순수 JSON만 출력)
            {
              "summary": "3줄 요약 (각 줄 개행)",
              "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
              "meta": "SEO용 메타 디스크립션 (160자 이내)",
              "sns": "SNS 공유용 매력적인 문구 (이모지 포함)",
              "titles": ["추천제목1", "추천제목2", "추천제목3"]
            }`
          },
          { role: 'user', content: textToAnalyze }
        ],
        temperature: 0.3
      })
    });

    const aiData = await groqResponse.json();

    if (!aiData.choices || !aiData.choices[0]) {
      console.error('Groq API Error:', aiData);
      return res.status(500).json({ error: 'AI 분석 서버 응답 오류: ' + (aiData.error?.message || JSON.stringify(aiData)) });
    }

    const cleanJson = aiData.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim();

    return res.status(200).json(JSON.parse(cleanJson));
  } catch (error) {
    console.error('Analysis Error:', error);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다: ' + error.message });
  }
}