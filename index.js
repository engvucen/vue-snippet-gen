const vueDocs = require('vue-docgen-api');
const rd = require('rd');
const fs = require('fs');
const path = require('path');
const { readPkg, help } = require('./util');

let matchNum = /^\d+$/;
// let matchStr = /^"|'([a-zA-Z\/\-_#]+|[\u4e00-\u9fa5\/\-_#]+)'|"$/;
let matchStr = /('.+'|".+")/;
let matchFunc = /(^\(\)\s*=>.+$)|(^function\s*\(\)\s*\{.+\}$)/;
// let matchEmptyStr = /^(''|\"\")$/;
let matchEmptyArr = /^\[\]$/;
let matchBool = /^(true|false)$/;
let matchUpperCase = /([A-Z])/g;
let matchPascal = /([a-z]+)(?=[A-Z])/g;
let matchPropNameReg = /[a-zA-Z_]+/;
let matchArr = /^\[.+\]$/;

let parseConf = getParseConf();
if (!parseConf.length) {
  console.log('Conf is empty!');
  return;
}
parseConf.map(curConf => {
  let { path: componentDir, tagNameType, mainComponents } = curConf;

  if (!componentDir) {
    console.log('Miss path!');
    help();
    return;
  }
  componentDir = componentDir.replace(/\\/g, '/');

  let componentInfoList = [];
  let componentLibName = componentDir.split('/')[0].match(/[a-z\-_]+/g)[0];
  let componentDirPath = `${process.cwd().replace(/\\/g, '/')}/node_modules/${componentDir}`;

  fs.access(componentDirPath, fs.constants.F_OK, err => {
    if (err) {
      console.log(`${componentLibName} doesn't exist!`);
      return;
    }

    if (mainComponents.length) {
      mainComponents = mainComponents.map(curPath => `${componentDirPath}/${curPath.replace(/\\/g, '/')}`);
    } else {
      rd.eachFileFilterSync(`${componentDirPath}`, /\.vue$/, (filePath, stats) => {
        mainComponents.push(filePath);
      });
    }
    mainComponents.forEach(filePath => {
      let result = vueDocs.parse(filePath, {
        jsx: true,
      });

      // ## 修改标签名的命名方式
      if (tagNameType === 'kebab') {
        // 组件库 导出对象名 一般是 Pascal
        // 默认-Pascal(AbC) => kebab(ab-c)(中划线)
        result.displayName = result.displayName.replace(matchPascal, '$1-').toLowerCase();
      }
      componentInfoList.push(result);
    });

    main({ data: componentInfoList, lib_name: componentLibName });
    // fs.writeFileSync(`${process.cwd()}/${componentLibName}.json`, JSON.stringify(componentInfoList, undefined, 4));
  });
});

function main(conf = { data: {}, lib_name: '' }) {
  let { data: componentInfoList, lib_name: libName } = conf;

  console.log(`----------------- ${libName.toUpperCase()} -----------------`);

  const componentAttrDesMap = {};
  let snippetData = {};
  let createSnippetFileConf = {
    path: `${process.cwd().replace(/\\/g, '/')}/.vscode`,
    file: `${libName}.code-snippets`,
    data: snippetData,
  };
  let componentPrefixes = [];
  componentInfoList.forEach(currentComponentInfo => {
    let { displayName, props, events, methods, slots } = currentComponentInfo;

    let componentName = displayName.toLowerCase();
    let prefix = `${libName}-${componentName}`;
    let desc = `@${libName} ${prefix}`;
    let snippetConstructor = getSnippetConstructor({ prefix, desc });

    let componentAttrs = [];
    if (props) {
      Object.keys(props).forEach(propsKey => {
        // ## 将驼峰props转为中划线props
        let { description, tags, defaultValue, type } = props[propsKey];

        // ## 检测到 tags 中包含 'ignore'，退出
        let { enum: enumTag, default: defaultTag, ignore: ignoreTag } = tags;
        if (ignoreTag && ignoreTag.some(curItem => curItem.title === 'ignore')) return;

        // ## 构造属性默认值(@enum > @default > props默认值)
        // todo:

        let enumList;
        let enumSnippetNum = 1;

        if (enumTag && enumTag.length) {
          try {
            let [enumConf] = enumTag;
            if (enumConf.description && matchArr.test(enumConf.description)) {
              enumList = JSON.parse(enumConf.description.replace(/'/g, '"'));

              if (Array.isArray(enumList)) {
                enumList = `\${${enumSnippetNum}:${enumList.join('|')}}`;
                enumSnippetNum++;
              }
            }
          } catch (error) {
            console.log('error', error);
          }
        }

        let curDefaultValue = (defaultTag && defaultTag.description) || (defaultValue && defaultValue.value) || '';
        let { type: defaultValueType, value: curValue } = parseDefaultValue(curDefaultValue, componentName, propsKey);

        let kebabCasePropsKey = propsKey.replace(matchUpperCase, '-$1').toLowerCase();
        // ## 按照 props_default 或者 自定义的默认值类型，决定是否转义默认值
        componentAttrs.push(
          `  ${(type && type.name !== 'string') || defaultValueType !== 'string' ? ':' : ''}${kebabCasePropsKey}="${
            enumList || curValue
          }"`
        );

        // ## 存储备注
        if (!componentAttrDesMap[componentName]) componentAttrDesMap[componentName] = {};
        componentAttrDesMap[componentName][kebabCasePropsKey] = description;
      });
    }
    if (events) {
      Object.keys(events).forEach(eventName => {
        let { description } = events[eventName];

        componentAttrs.push(`  @${eventName}=""`);
        if (!componentAttrDesMap[componentName]) componentAttrDesMap[componentName] = {};
        componentAttrDesMap[componentName][eventName] = description;
      });
    }

    // ## 为匹配属性添加备注 - Full 版本
    snippetConstructor[desc].body = [
      '<!--',
      `<${displayName}`,
      ...addDescToMatchAttr({
        attrs: componentAttrs,
        attrToDescMap: componentAttrDesMap[componentName],
      }),
      `>`,
      ...getSlotsContent(slots),
      `<${displayName}/>`,
      '-->',
    ];

    Object.assign(snippetData, snippetConstructor);

    // ### 打印列表的存储
    componentPrefixes.push(prefix);
  });

  writeToProjectSnippets(createSnippetFileConf);
  // console.log('Snippets is in .vscode folder.');

  // ## 打印指令列表
  const PLACEHOLDER_MAX = 2;
  console.log(`Prefix List:`);
  console.log(
    componentPrefixes
      .map((curPrefix, index) => {
        let num = index + 1 + '';
        let numLength = num.length;

        let placeholderNum = PLACEHOLDER_MAX - numLength;

        return `${num}${new Array(placeholderNum > 0 ? placeholderNum : 0).fill(' ').join('')}: ${curPrefix}`;
      })
      .join('\n')
  );
  console.log('\n');
}

/**
 *
 * @param {String} defaultValue
 * @returns {Object} result {type: '', value: ''}
 */
function parseDefaultValue(defaultValue = '', componentName = '', propsKey = '') {
  // NOTE: JSDocs 返回的 defaultValue.value 是字符串，需要解决一些格式问题（单引号）
  defaultValue = defaultValue.replace(/\n+/g, ' ').replace(/\s+/g, ' ');

  // ## 找到符合指定匹配规则的字符串
  let result = false;
  let matchFuncArr = [
    value => matchNum.test(value) && 'number',
    value => matchStr.test(value) && 'string',
    value => matchFunc.test(value) && 'function',
    // value => matchEmptyStr.test(value) && 'emptyString',
    value => matchEmptyArr.test(value) && 'emptyArray',
    value => matchBool.test(value) && 'boolean',
  ];
  while (matchFuncArr.length !== 0 && !result) {
    let func = matchFuncArr.pop();
    result = func(defaultValue) || false;
  }
  // ### 目标不匹配任意一条规则，返回目标本身
  if (!result) return { type: 'string', value: defaultValue };

  // ## 转换目标
  switch (result) {
    case 'number':
      defaultValue = Number.parseInt(defaultValue);
      break;
    case 'string':
      defaultValue = defaultValue.replace(matchStr, '$1').replace(/['"]/g, '');
      break;
    case 'function':
      try {
        defaultValue = JSON.stringify(eval(`[${defaultValue}]`)[0]());
      } catch (error) {
        console.log(`Function Parse Error. See ${componentName} ${propsKey}: ${defaultValue}`);
        defaultValue = '';
      }
      if (typeof defaultValue === 'string') defaultValue = defaultValue.replace(/"/g, "'") || '';
      break;
    // case 'emptyString':
    //   defaultValue = '';
    //   break;
    case 'emptyArray':
      defaultValue = [];
      break;
    case 'boolean':
      defaultValue = defaultValue === 'true';
      break;
  }

  return { type: result, value: defaultValue };
}
/**
 * 根据 slots 获取 ‘text’ 或 <span name='key'>text</span>
 * @param {Object}} slots {default, icon, ..slots}
 * @returns {Array} result []
 */
function getSlotsContent(slots) {
  let result = [];

  let slotsKeys = Object.keys(slots);
  if (slotsKeys.length) {
    slotsKeys.forEach(slotKey => {
      switch (slotKey) {
        case 'default':
          result.push('  text');
          break;
        default:
          result.push(`  <span slot="${slotKey}">text</span>`);
          break;
      }
    });
  }

  return result;
}
/**
 * 为匹配属性添加备注；返回一个操作后的字符串数组
 * @param {object} conf {body: [], attrToDescMap: [] }
 * @returns {array} body
 */
function addDescToMatchAttr(conf = { tags: [], attrToDescMap: {} }) {
  let { attrs, attrToDescMap } = conf;

  let tagsLength = attrs.length;
  for (let i = 0; i < tagsLength; i++) {
    let propAndValue = attrs[i];

    // {type, offset-bottom ..}
    if (attrToDescMap) {
      let propsNames = Object.keys(attrToDescMap);

      let propName = propsNames.find(curName => {
        let matchResult = propAndValue.match(matchPropNameReg);
        if (matchResult) return matchResult[0] === curName;
      });
      if (propName) {
        let desc = attrToDescMap[propName];
        if (desc) {
          desc = desc.replace(/\n/g, '; ');
          attrs[i] = `${propAndValue} // ${desc}`;
        }
      }
    }
  }

  return attrs;
}
/**
 * 从 prefix/desc 获取 snippet 基础结构
 * @param {object} conf
 * @returns {object} result { [desc]: { ... } }
 */
function getSnippetConstructor(conf = { prefix: '', desc: '' }) {
  let { prefix, desc } = conf;
  return {
    [desc]: {
      scope: ['javascript', 'vue'],
      prefix,
      description: desc,
      body: [],
    },
  };
}
function afterInitDirAndFile(conf) {
  let { path: curPath, file: curFilePath, success: successCallBack, error: errorCallBack, data } = conf;

  let fileExistPath = path.resolve(__dirname, curPath, curFilePath);
  Object.assign(conf, { file_exist_path: fileExistPath });

  // ## 检测文件是否存在
  fs.access(fileExistPath, fs.constants.F_OK, err => {
    if (!err) {
      successCallBack(conf);
    } else {
      console.log(`${fileExistPath} doesn’t exist. Created directory, file.`);

      // ### 文件不存在，可能是 目录不存在，也可能是 文件不存在
      let folderPath = path.resolve(__dirname, curPath);
      fs.mkdirSync(folderPath, { recursive: true });
      // 默认 flag = 'w'，文件不存在会创建它
      fs.writeFileSync(path.resolve(__dirname, fileExistPath), JSON.stringify({}, undefined, 2), 'utf8', err => {
        if (err) {
          console.log(`${curPath} ${err}`);
        }
      });

      errorCallBack(conf);
    }
  });
}
function writeToProjectSnippets(conf = { path: '', file: '', data: {} }) {
  afterInitDirAndFile({
    ...conf,
    success(conf) {
      fs.writeFile(conf.file_exist_path, JSON.stringify(conf.data, undefined, 2), 'utf8', err => {
        if (err) {
          console.log('writeToProjectSnippets', `${conf.path} ${err}`);
        }
      });
    },
    error(conf) {
      writeToProjectSnippets(conf);
    },
  });
}
/**
 * 返回 命令行（优先） 或 package.json配置
 * returns {Array} parseConf [ {*path: '', tagNameType: '',(默认 kebab), mainComponents: []} ]
 */
function getParseConf() {
  // note: 命令仅支持 path / --tag-kebab-case(默认origin，参数无效不处理), 会解析所有 vue 文件；配置以命令行优先
  let processArgs = process.argv;

  let parseConf = [];
  if (processArgs.length && processArgs.indexOf('--conf') === -1) {
    let curConf = {
      path: '',
      tagNameType: 'origin',
      mainComponents: [],
    };
    let tagNameTypeIndex = processArgs.indexOf('--tag-kebab-case');
    if (tagNameTypeIndex > -1) {
      curConf.tagNameType = 'kebab';
      processArgs.splice(tagNameTypeIndex, 1);
    }
    let [, , , componentDir] = processArgs;
    curConf.path = componentDir || '';

    parseConf.push(curConf);
  } else {
    let pkgConf = readPkg()['vue-snippet-gen'] || [];
    if (Array.isArray(pkgConf) && pkgConf.length) {
      parseConf = pkgConf.map(curItem => {
        [
          { key: 'path', defaultValue: '', target: curItem },
          { key: 'tagNameType', defaultValue: 'origin', target: curItem },
          { key: 'mainComponents', defaultValue: [], target: curItem },
        ].forEach(curItem => {
          let { key, defaultValue, target } = curItem;
          if (target[key] === undefined) target[key] = defaultValue;
        });
        curItem.mainComponents.forEach(name => (name = name.toLowerCase()));

        return curItem;
      });
    }
  }

  return parseConf;
}
