const playwright = require('playwright');
const TurndownService = require('turndown');
const fs = require('fs').promises;
//fs.writeFile(filename, data, [encoding], [callback])

const turndownService = new TurndownService();
turndownService.addRule('linebreak', {
  filter: 'br',
  replacement: (content, node, options) => {
    if (node.previousElementSibling && node.previousElementSibling.nodeName === 'BR') {
        return '\n\n'
    }
    return '<br>'
  }
});

(async () => {
  const browser = await playwright['webkit'].launch();
  const indexUrl = 'https://intercom.help/autify/ja/collections/1710888-faqs';
  const baseUrl = indexUrl.split('/').splice(0,3).join('/')
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(indexUrl);

  const urls = await page.$$eval('a[href^="/autify/ja/articles/"]', (elements, arr) => {
    const urls = []
    elements.forEach((element) => {
      urls.push(element.getAttribute("href"));
    })
    return Promise.resolve(urls);
  });

  let index = 1;
  for(let url of urls) {
    console.log(`updating: ${url} (${index}/${urls.length})`);
    try {
      const id = url.match(/\/(\d+)-.+$/)[1];
      await page.goto(baseUrl + url);
      const title = await page.$eval("h1.t__h1", (el) =>  el.innerText);
      const desc = await page.$eval(".article__desc", (el) =>  el.innerText);
      const bodyHtml = await page.$eval("article", (el) =>  el.innerHTML);
      const bodyMd = turndownService.turndown(bodyHtml);
    
      await fs.writeFile("docs/ja/" + id + ".md", `---
id: ${id}
title: ${title}
desc: ${desc}
---

${bodyMd}`);
    } catch (e) {
      console.log(e);
    }

    index++;
  };

  await browser.close();
})();
