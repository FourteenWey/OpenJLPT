# NOTICE：数据来源与署名

本项目 `public/data/` 下的词表是 [OpenJLPT](https://github.com/evanclan/OpenJLPT) 的衍生数据
（固定提交 `0d1d3410bec90bd4098a7c72de820543cb4f707c`，数据版本 0.3.0），只保留词形、读音、英文释义、词性、级别、
JMdict ID 与其他写法，以及每词最多 1 条例句（日文原句、英文译文与 Tatoeba 句子 ID），未包含罗马字与注音。

> Contains data from [OpenJLPT](https://github.com/evanclan/OpenJLPT) (CC BY-SA 4.0), which uses
> JMdict and KANJIDIC2 (EDRDG), Jonathan Waller's JLPT lists, and Tatoeba.

## 你需要遵守的条件（CC BY-SA 4.0）

1. 署名：保留上面这句话以及本文件；应用「数据」页已显示同样的署名。
2. 提供 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 许可链接。完整许可文本在 `third_party/OpenJLPT/LICENSE`。
3. 相同方式共享：再分发含这些词表的数据或衍生数据集时，必须同样使用 CC BY-SA 4.0。仅自己本机使用不涉及再分发。

## 上游来源

- Jonathan Waller 的 JLPT 词表（tanos.co.uk，CC BY）：N5–N1 级别划分与英文释义。
- JMdict（EDRDG，CC BY-SA 4.0）：词性与读音校验。使用须符合 [EDRDG 许可](https://www.edrdg.org/edrdg/licence.html)。
- Tatoeba（CC BY 2.0 FR）：例句来源。每条例句带 Tatoeba 句子 ID，可在 `https://tatoeba.org/sentences/show/<ID>` 查看句子及其贡献者；应用在翻卡后显示该链接。

上游自述文件原文在 `third_party/OpenJLPT/NOTICE.md`。

## 级别说明

日本国际交流基金会并未公布官方的 N5–N1 词汇表。OpenJLPT 使用的是社区通行的非官方整理，只是对真实考试内容的近似。
本工具的所有「掌握率」都是相对于所选词表（样本框）的比例，不是对 JLPT 真题的预测。

## 中文释义（AI 生成）

`public/data/openjlpt-n3-zh.json` 是为本项目新写的 N3 词中文释义，由 AI 依据 OpenJLPT 的词形、读音、词性与英文释义生成，
未经人工校对，不是 JMdict 原文。它与英文释义一样随词表按 CC BY-SA 4.0 提供。生成时没把握的词记在文件的 `uncertain` 列表里，
应用中显示为「AI 生成 · 待核对」。用户导入的 `meaning_zh` 优先于它显示。

## 语音朗读（VOICEVOX）

朗读功能通过 HTTP 调用用户本机运行的 [VOICEVOX Engine](https://github.com/VOICEVOX/voicevox_engine)，本项目不包含其代码或语音模型。
合成的声音为 もち子さん（cv 明日葉よもぎ），使用须遵守 [VOICEVOX 的使用规约](https://voicevox.hiroshiba.jp/term/) 与该角色的使用条款；公开发布含这些声音的内容时需署名：`VOICEVOX:もち子(cv 明日葉よもぎ)`。应用「数据」页已显示该署名。

## 本项目的修改

- 取自 `data/json/vocab/` 下的 `n1.json` 到 `n5.json`，字段改名（`jmdict_id` → `jmdictId`、`other_forms` → `otherForms`、`examples` → 单条 `example`），丢弃 `romaji` 与例句注音。
- 例句保留第 1 条通过读音核对的句子。N3–N5 的多音词在这三个级别内比较，N1 和 N2 的多音词在全部五个级别内比较，只保留注音能确认读音一致的例句。
- 生成脚本：`scripts/fetch-openjlpt.mjs`。
