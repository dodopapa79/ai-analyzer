import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  const { type, content } = req.body;
  let textToAnalyze = '';

  try {
    // 1. 콘텐츠 가져오기
    if (type === 'url') {
      const response = await axios.get(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const $ = cheerio.load(response.data);
      $('script, style, nav, footer, header').remove();
      textToAnalyze = $('body').text().replace(/\s+/g, ' ').trim();
      
      if (textToAnalyze.length < 100) {
        return res.status(400).json({ error: '해당 URL에서 충분한 텍스트를 찾을 수 없습니다.' });
      }
    } else {
      textToAnalyze = content;
    }

    textToAnalyze = textToAnalyze.substring(0, 4000);

    // 2. Groq AI에게 분석 요청
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `당신은 전문 SEO 및 콘텐츠 분석가입니다. 다음 텍스트를 분석하여 정확히 아래 JSON 형식으로만 답변하세요. (마크다운 코드 블록 사용하지 말고 순수 JSON만 출력)
            {
              "summary": "3줄 요약 (각 줄 개행)",
              "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
              "meta": "SEO용 메타 디스크립션 (160자 이내)",
              "sns": "SNS 공유용 매력적인 문구 (이모지 포함)",
              "titles": ["추천제목1", "추천제목2", "추천제목3"]
            }`
          },
          {
            role: 'user',
            content: textToAnalyze
          }
        ],
        temperature: 0.3
      })
    });

    const aiData = await groqResponse.json();
    
    let result;
    try {
      const cleanJson = aiData.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim();
      result = JSON.parse(cleanJson);
    } catch (e) {
      return res.status(500).json({ error: 'AI 응답 파싱 실패', raw: aiData.choices[0].message.content });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Analysis Error:', error);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다.' });
  }
}