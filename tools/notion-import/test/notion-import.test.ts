import { describe, expect, it } from 'vitest';
import {
  detectNotionCsvType,
  parseCsv,
  parseNotionDateTime,
  parseNotionFiles,
  stripNotionLink,
  toCsv,
} from '../src/index.js';

describe('@timebook/notion-import', () => {
  it('parses UTF-8 BOM, quoted multiline cells, and generates CSV roundtrip', () => {
    const csv = '\uFEFF"姓名","备注"\r\n"张三","第一行\n第二行, ""重点"""\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['姓名', '备注']);
    expect(parsed.rows).toEqual([{ 姓名: '张三', 备注: '第一行\n第二行, "重点"' }]);

    const out = toCsv(['A', 'B'], [['x,y', 'z"w']]);
    expect(out.startsWith('\uFEFF')).toBe(true);
    expect(parseCsv(out).rows[0]).toEqual({ A: 'x,y', B: 'z"w' });
  });

  it('strips notion links and parses CN/EN/ISO datetime formats in Asia/Shanghai', () => {
    expect(stripNotionLink('工作 (https://www.notion.so/123456)')).toBe('工作');
    const tsCn = parseNotionDateTime('2026年11月18日 12:05');
    const tsSlash = parseNotionDateTime('2026/11/18 12:05');
    const tsEn = parseNotionDateTime('November 18, 2026 12:05 PM (GMT+8)');
    expect(tsCn).toBe(tsSlash);
    expect(tsCn).toBe(tsEn);
    expect(tsCn).toBe(Date.UTC(2026, 10, 18, 4, 5, 0));
  });

  it('parses realistic 3-table Notion CSVs accurately', () => {
    const tagsCsv = [
      '标签,一级标签,颜色',
      '工作,,blue',
      '学习,,violet',
      '游戏,,teal',
      '锻炼,,rose',
      '个人工作,工作 (https://www.notion.so/m1),',
      '淘教,工作 (https://www.notion.so/m1),',
      '淘宝天下,工作 (https://www.notion.so/m1),',
      '行者,工作 (https://www.notion.so/m1),',
      '各培训机构合作,工作 (https://www.notion.so/m1),',
      'Python,学习 (https://www.notion.so/m2),',
      '钻研,学习 (https://www.notion.so/m2),',
      '单机游戏,游戏 (https://www.notion.so/m3),',
      '星穹铁道,游戏 (https://www.notion.so/m3),',
      '原神,游戏 (https://www.notion.so/m3),',
      '绝区零,游戏 (https://www.notion.so/m3),',
      '异环,游戏 (https://www.notion.so/m3),',
      '健身,锻炼 (https://www.notion.so/m4),',
      '羽毛球,锻炼 (https://www.notion.so/m4),',
    ].join('\n');

    const sessionsCsv = [
      '日历标题,状态,标签,待办,开始,结束',
      'FDE项目开发,已完成,个人工作 (https://www.notion.so/t1),,2026年11月18日 09:00,2026年11月18日 11:30',
      '影之刃零,已完成,单机游戏 (https://www.notion.so/t2),,2026/11/18 20:00,2026/11/18 22:00',
      '原神,已完成,原神 (https://www.notion.so/t3),,"November 18, 2026 10:00 PM (GMT+8)","November 18, 2026 11:00 PM (GMT+8)"',
      '取消的任务,已取消,个人工作 (https://www.notion.so/t1),,2026/11/18 13:00,2026/11/18 14:00',
      '无标签记录,已完成,,,2026/11/18 15:00,2026/11/18 16:00',
      '进行中忘了点结束,进行中,Python (https://www.notion.so/t4),,2026/11/18 17:00,',
    ].join('\n');

    const todosCsv = [
      '事项,状态,执行日期,截止日期',
      '完成周报,未开始,2026年11月19日,2026年11月20日',
      '已完成的旧待办,Done,2026/11/15,',
    ].join('\n');

    expect(detectNotionCsvType(['标签', '一级标签', '颜色'])).toBe('tags');
    expect(detectNotionCsvType(['日历标题', '状态', '标签', '开始', '结束'])).toBe('sessions');
    expect(detectNotionCsvType(['事项', '状态', '执行日期', '截止日期'])).toBe('todos');

    const preview = parseNotionFiles([
      { name: '时间标签.csv', content: tagsCsv },
      { name: '专注记录.csv', content: sessionsCsv },
      { name: '待办.csv', content: todosCsv },
    ]);

    expect(preview.modules).toHaveLength(4);
    expect(preview.tags).toHaveLength(14);
    expect(preview.skippedCancelledSessions).toBe(1);
    expect(preview.skippedDoneTodos).toBe(1);
    expect(preview.validSessions).toHaveLength(3);
    expect(preview.validSessions[0].title).toBe('FDE项目开发');
    expect(preview.validSessions[1].title).toBe('影之刃零');
    // 标题与匹配二级事项名相同（原神），置 null 避免重复展示
    expect(preview.validSessions[2].title).toBeNull();
    expect(preview.issues).toHaveLength(2);
    expect(preview.issues[0].reasons).toContain('missing_tag');
    expect(preview.issues[1].reasons).toContain('missing_end');
    expect(preview.validTodos).toHaveLength(1);
    expect(preview.validTodos[0]).toEqual({
      title: '完成周报',
      tagName: null,
      plan_date: '2026-11-19',
      due_date: '2026-11-20',
    });

    const workTotal = preview.moduleTotals.find((m) => m.moduleName === '工作');
    const gameTotal = preview.moduleTotals.find((m) => m.moduleName === '游戏');
    expect(workTotal?.totalMinutes).toBe(150);
    expect(gameTotal?.totalMinutes).toBe(180);
  });
});
