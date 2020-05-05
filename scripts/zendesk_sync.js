require('dotenv').config()

const https = require('https')
const request = require('request')

const path = require('path')
const fs = require('fs')

const unified = require('unified')
const parse = require('remark-parse')
const frontmatter = require('remark-frontmatter')
const remark2rehype = require('remark-rehype')
const html = require('rehype-stringify')
const meta = require('remark-meta')
const remarkProcessor = unified()
  .use(parse)
  .use(frontmatter, ['yaml'])
  .use(meta)
  .use(remark2rehype)
  .use(html)
  .use(() => { console.dir })

const baseUrl = "https://autify.zendesk.com/api/v2/help_center"
const faqSectionId = 900000096343

class Zendesk {
  constructor() {
    this.auth = {
      'user': 'ryo@autify.com/token',
      'pass': process.env.ZENDESK_API_TOKEN
    }
  }

  callAPI(options, cb) {
    options["auth"] = this.auth

    request(options, (error, response, body) => {
      const statusType = Math.floor(response.statusCode / 100)
      if (!error && statusType == 2) {
        cb(body)
      } else {
        console.log(error, response, body)
        throw new Error(error)
      }
    })
  }

  createArticle(sectionId, params, cb) {
    const options = {
      url: baseUrl + `/sections/${sectionId}/articles.json`,
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      json: params
    }
    this.callAPI(options, (body) => {
      if (cb) {
        cb(body.article)
      }
    })
  }

  updateArticle(articleId, params, cb) {
    const options = {
      url: baseUrl + `/articles/${articleId}.json`,
      method: "PUT",
      headers: {
        'Content-Type': 'application/json'
      },
      json: params
    }
    this.callAPI(options, (body) => {
      if (cb) {
        cb(body.article)
      }
    })
  }

  createTranslation(articleId, params, cb) {
    const options = {
      url: baseUrl + `/articles/${articleId}/translations.json`,
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      json: params
    }
    this.callAPI(options, (body) => {
      if (cb) {
        cb(body.translation)
      }
    })
  }

  updateTranslation(articleId, locale, params, cb) {
    const options = {
      url: baseUrl + `/articles/${articleId}/translations/${locale}.json`,
      method: "PUT",
      headers: {
        'Content-Type': 'application/json'
      },
      json: params
    }
    this.callAPI(options, (body) => {
      if (cb) {
        cb(body.translation)
      }
    })
  }
}


class FileHandler {
  constructor(filePath, locale) {
    this.filePath = filePath
    this.locale = locale
    this.content = null
    this.vfile = null
  }

  readFile(cb) {
    fs.readFile(this.filePath, 'utf-8', (err, content) => {
      console.log(err)
      this.content = content
      if (!err) {
        remarkProcessor.process(content, (err, vfile) => {
          if (err) throw err
          this.vfile = vfile

          cb(this)
        })
      }
    })
  }

  getZdArticle() {
    return {
      "title": this.vfile.data.title,
      "body": this.vfile.contents,
      "locale": this.locale
    }
  }

  exist() {
    return (this.vfile !== null)
  }

  getZendeskId() {
    return this.vfile.data.zid
  }

  setZendeskId(zid, cb) {
    const newData = this.content.replace("---\n\n", `zid: ${zid}\n---\n\n`)
    fs.writeFile(this.filePath, newData, (err) => {
      if (err) throw err
      cb()
    })
  }
}


class ArticleHandler {
  constructor(jaFilePath) {
    this.jaFilePath = jaFilePath
    this.enFilePath = this.jaFilePath.replace("ja", "en")

    this.jaFileHandler = new FileHandler(this.jaFilePath, "ja")
    this.enFileHandler = new FileHandler(this.enFilePath, "en-us")

    this.zendesk = new Zendesk()
  }

  pushToZendesk(includeOriginal = true) {
    this.jaFileHandler.readFile(() => {
      try {
        this.enFileHandler.readFile(() => {
          this.createOrUpdateArticle(includeOriginal)
        })
      } catch {
        this.createOrUpdateArticle(includeOriginal)
      }
    })
  }

  createOrUpdateArticle(includeOriginal) {

    let translations = []

    const zendeskId = this.jaFileHandler.getZendeskId()

    if (includeOriginal) {
      translations.push(this.jaFileHandler.getZdArticle())
    }
    if (this.enFileHandler.exist) {
      translations.push(this.enFileHandler.getZdArticle())
    }

    if (zendeskId) {
      //update
      console.log("to be updated: " + this.jaFileHandler.filePath)
      //this.zendesk.updateArticle(zendeskId, params, (article) => {
      //})

      translations.forEach((article) => {
        if (article["locale"] == "en-us") {
          if (this.enFileHandler.getZendeskId()) {
            //update translation
            this.zendesk.updateTranslation(zendeskId, article["locale"], article)
          } else {
            //create translation
            this.zendesk.createTranslation(zendeskId, article)
          }
        } else {
          this.zendesk.updateTranslation(zendeskId, article["locale"], article)
        }
      })
    } else {
      //create
      console.log("create: " + this.jaFileHandler.filePath)
      const params = {
        "article": {
          "translations": translations,
          "user_segment_id": null,
          "permission_group_id": 900000026583
        },
        "notify_subscribers": false
      }
      this.zendesk.createArticle(faqSectionId, params, (article) => {
        this.jaFileHandler.setZendeskId(article.id, () => {
        })
        this.enFileHandler.setZendeskId(article.id, () => {
        })
      })
    }
  }
}


function syncArticles() {
  //read all original files
  const directoryPath = path.join(__dirname, '..', 'docs', "ja")
  fs.readdir(directoryPath, function (err, files) {
    if (err) throw err
  
    for (let i = 0; i < files.length; i++) {
      const filename = files[i]
      const filePath = path.join(directoryPath, filename)
      const articleHandler = new ArticleHandler(filePath)
      setTimeout(() => {
        articleHandler.pushToZendesk()
      }, i * 1000)
    }
  })
}

syncArticles()
