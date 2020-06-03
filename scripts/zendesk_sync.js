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
        console.log(body)
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
      this.content = content
      if (!err) {
        remarkProcessor.process(content, (err, vfile) => {
          if (err) throw err
          this.vfile = vfile

          cb(this)
        })
      } else {
        cb(this)
      }
    })
  }

  getZdArticle() {
    if (this.vfile == null) {
      return null
    }

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
    if(!this.exist()) {
      cb()
      return
    }

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

  pushToZendesk(includeOriginal = true, cb) {
    this.jaFileHandler.readFile(() => {
      this.enFileHandler.readFile(() => {
        this.createOrUpdateArticle(includeOriginal, cb)
      })
    })
  }

  createOrUpdateArticle(includeOriginal, cb) {

    let translations = []

    let jaArticle, enArticle

    const zendeskId = this.jaFileHandler.getZendeskId()

    if (includeOriginal) {
      translations.push(this.jaFileHandler.getZdArticle())
    }
    if (this.enFileHandler.exist()) {
      translations.push(this.enFileHandler.getZdArticle())
    }

    if (zendeskId) {
      //update
      console.log("to be updated: " + this.jaFileHandler.filePath)

      const nextTranslation = (index) => {
        if (index >= translations.length) {
          cb()
          return
        }

        const next = () => {
          nextTranslation(index + 1)
        }

        const article = translations[index]
        if (article["locale"] == "en-us") {
          if (this.enFileHandler.getZendeskId()) {
            //update translation
            this.zendesk.updateTranslation(zendeskId, article["locale"], article, next)
          } else {
            //create translation
            this.zendesk.createTranslation(zendeskId, article, next)
          }
        } else {
          this.zendesk.updateTranslation(zendeskId, article["locale"], article, next)
        }
      }
      nextTranslation(0)

      /*
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
      */
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
          this.enFileHandler.setZendeskId(article.id, cb)
        })
      })
    }
  }
}

let allFiles = []
const directoryPath = path.join(__dirname, '..', 'docs', "ja")

function nextFile(index) {
  if (index >= allFiles.length) {
    return
  }

  const filename = allFiles[index]
  const filePath = path.join(directoryPath, filename)
  const articleHandler = new ArticleHandler(filePath)

  console.log(`syncing: ${filename} (${index + 1}/${allFiles.length})`)

  articleHandler.pushToZendesk(true, () => {
    nextFile(index + 1)
  })
}

function syncArticles() {
  //read all original files
  fs.readdir(directoryPath, function (err, files) {
    if (err) throw err
  
    allFiles = files
    nextFile(0)
  })
}

syncArticles()
