// `pnpm sgh:aplicar` (ficha do M04, regra 11 e seção 10): scripts SGH_ só com objetos SGH_, em ordem, com
// hash; idempotente; recusa hash diferente, objeto sem registro e produção sem autorização registrada.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import type { Escritor, Leitor } from '../transacao.js';
import { aplicarScripts, type AcessoScripts } from './aplicador.js';
import {
  comandosDoScript,
  conferirComandoSgh,
  ErroScriptSgh,
  hashScript,
  lerScriptsSgh,
  objetosCriados,
  planejarScripts,
  type ScriptSgh,
} from './scripts.js';
import { semImagem } from '../como.js';

const raizSrc = resolve(import.meta.dirname, '../..');

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? arquivosTs(c) : n.endsWith('.ts') ? [c] : [];
  });
}
// TMPDIR do processo: a pasta .tmp do repositório (tools/ambiente.sh; POL-4).
const tmp = mkdtempSync(join(tmpdir(), 'sgh-aplicar-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('scripts SGH_ do repositório', () => {
  const scripts = lerScriptsSgh(raizSrc);
  it('os 5 do M04 (0001 a 0005), em ordem, mais os do M05, do M06, do M08, do ADR 0021, do M09, do ADR 0022, do M11, do M12, do M10, do M13, do M15, do M14, do M16, do M17, do M18, do M19, do M20, do M21, do M22, do M23, do M24, do M25, do M26, do M27, do M28, do M29, do M30, do M31, do M32, do M33, do M34, do M37, do M38, do M39, do M43, do M44 (etapas 1, 2 e 3), do M47 (etapas 1 e 2), do M45 (etapas 1 a 5, com as correções 0943 e 0944 e a etapa 6 no 0945 e no 0946 fora da faixa), do M46 (etapas 1 a 4, a 4 com a correção 0469 e a 0968 e a 0969 fora da faixa), do M49 (etapas 1 a 3), do M50 (etapas 1 a 6, a 4 com o 0954 e o 0974, a 5 com o 0955 e a 6 com 0965 a 0967 fora da faixa), do M52 (etapa 1, com a correção 0525, e a etapa 2 de 0526 a 0528, com a correção 0985 fora da faixa, e a etapa 3 de 0991 a 0993, a etapa 4 de 0986 a 0989 e a etapa 6 no 0994 e no 0995, fora da faixa; a correção 0996 do M53.6, a etapa 7 do M53 no 0997 e no 0998 a etapa 8 no 0999 e a etapa 9 no 0981, fora da faixa), do M56 (etapas 2, 3 e 4, com as correções 0956 e 0957 fora da faixa, a etapa 5 no 0958 e no 0959 e a etapa 6 no 0950 e no 0951 e a etapa 7 no 0952 e no 0953 e a etapa 8 no 0960 e no 0961 fora da faixa), do M47 (etapa 3, no 0477 a 0479), do M48 (etapa 1, no 0480, etapa 2, no 0481 e no 0482, e etapa 3, no 0483, com a correção 0975 fora da faixa, e etapa 4, no 0484, e etapa 5, no 0485 e no 0486), do M51 (etapa 1, com a correção 0515 e etapa 2 no 0516, etapa 3 no 0517 e etapa 4 no 0518 e no 0519), do M53 (etapa 1, de 0530 a 0532, etapa 3, de 0533 a 0535, etapa 4, no 0536 e no 0537, etapa 5, no 0538, e etapa 6, no 0539), do M54 (etapa 1, de 0540 a 0542, etapa 2, no 0543 e no 0544, com as correções 0545 e 0547; etapa 3, no 0976 fora da faixa; etapa 4, no 0546; etapa 5, no 0576, com a correção 0577, fora da faixa; etapa 6, no 0548, com a correção 0977 fora da faixa; etapa 7, no 0549), do M55 (etapa 1, de 0550 a 0553, etapa 5 no 0555, etapa 2, no 0556, e etapa 4, no 0554, com a correção 0948 fora da faixa), do M55 (etapa 3, de 0557 a 0559), do M57 (etapa 1), do M58 (etapa 1, no 0580) e do M59 (etapa 2, no 0590 e no 0591, etapa 3, no 0592, etapa 4, no 0593, e etapa 5, de 0594 a 0596); só objetos SGH_', () => {
    // W0-02: os scripts dos pacotes do programa CRUD completo (1000 em diante, cada um na sua faixa: docs/operacoes/README.md
    // §4.3) são conferidos no teste do próprio pacote; esta lista é a de antes do programa (não cresce mais).
    expect(scripts.filter((s) => s.numero < 1000).map((s) => s.numero)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 101, 111, 112, 113, 114, 120, 121, 122,
      123, 130, 131, 140, 141, 150, 151, 160, 161, 162, 170, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189,
      190, 191, 192, 193, 199, 200, 201, 202, 203, 204, 205, 210, 211, 212, 213, 214, 215, 220, 221, 222, 223,
      224, 225, 226, 227, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246,
      247, 248, 250, 251, 252, 253, 254, 255, 256, 257, 260, 261, 262, 263, 264, 265, 266, 267, 270, 271, 280,
      281, 282, 283, 284, 285, 286, 287, 290, 291, 292, 293, 294, 295, 296, 300, 301, 302, 303, 304, 305, 306,
      310, 311, 312, 313, 314, 315, 316, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333,
      334, 335, 340, 341, 342, 343, 344, 345, 346, 347, 370, 371, 372, 373, 374, 375, 376, 380, 390, 391, 430,
      431, 432, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458,
      459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 477, 478, 479, 480, 481, 482,
      483, 484, 485, 486, 490, 491, 492, 493, 494, 495, 496, 497, 498, 500, 501, 502, 503, 504, 505, 506, 507,
      508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528,
      529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549,
      550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570,
      571, 572, 573, 574, 575, 576, 577, 580, 590, 591, 592, 593, 594, 595, 596, 943, 944, 945, 946, 948, 950,
      951, 952, 953, 954, 955, 956, 957, 958, 959, 960, 961, 965, 966, 967, 968, 969, 974, 975, 976, 977, 981,
      985, 986, 987, 988, 989, 991, 992, 993, 994, 995, 996, 997, 998, 999,
    ]);
    expect(scripts.slice(0, 5).map((s) => s.arquivo)).toEqual([
      'config/sgh/0001_versao_script.sql',
      'integracao/sgh/0002_outbox.sql',
      'integracao/sgh/0003_idempotencia.sql',
      'auditoria/sgh/0004_trilha.sql',
      'config/sgh/0005_cfg_liberacao.sql',
    ]);
    for (const s of scripts) for (const c of s.comandos) expect(() => conferirComandoSgh(c)).not.toThrow();
  });

  it('M10: escopo de setor e pedidos do titular com DELETE só para o Corrigir; nenhum código exclui nelas', () => {
    const doM10 = scripts.filter((x) => x.numero >= 130 && x.numero <= 139);
    expect(doM10.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/0130_escopo_setor.sql',
      'auditoria/sgh/0131_pedido_titular.sql',
    ]);
    const grants = doM10.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE, DELETE ON SGH_ACESSO_ESCOPO_SETOR TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON SGH_AUD_PEDIDO_TITULAR TO ROLE SGH_APLICACAO',
    ]);
    const fontes = arquivosTs(raizSrc).filter((f) => !/\.spec\.ts$|\.spec-util\.ts$/.test(f));
    for (const f of fontes)
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /DELETE\s+FROM\s+SGH_(?:ACESSO_ESCOPO_SETOR|AUD_PEDIDO_TITULAR)/i,
      );
  });

  it('M12: toda tabela SGH_ do marco que recebe imagem no "como" dá DELETE ao papel (Corrigir de inclusão), e só a compensação exclui nelas', () => {
    const doM12 = scripts.filter((x) => x.numero >= 120 && x.numero <= 123);
    const grants = doM12.flatMap((x) => x.comandos).filter((c) => /^GRANT /i.test(c));
    const com = (priv: string) =>
      new Set(
        grants.flatMap((g) => {
          const m = /^GRANT (.+) ON (?:TABLE )?(\w+) TO ROLE SGH_APLICACAO$/i.exec(g);
          return m && m[1]!.split(/,\s*/).includes(priv) ? [m[2]!.toUpperCase()] : [];
        }),
      );
    const insert = com('INSERT');
    const del = com('DELETE');
    expect([...insert].sort()).toEqual([
      'SGH_CAD_CONVENIO_PLANO',
      'SGH_CAT_CARGA',
      'SGH_CAT_CARGA_LINHA',
      'SGH_PRECO_AUTORIA',
    ]);
    for (const t of insert) {
      expect(semImagem(t)).toBe(false);
      expect(del.has(t)).toBe(true);
    }
    // Nenhum código da aplicação exclui nessas tabelas: o DELETE é só o da compensação do Corrigir, que
    // monta o comando pela imagem (suporte/correcao.ts), sem o nome da tabela no fonte.
    const fontes = arquivosTs(raizSrc).filter((f) => !/\.spec\.ts$|\.spec-util\.ts$/.test(f));
    for (const f of fontes) {
      const texto = readFileSync(f, 'utf8');
      expect(texto, f).not.toMatch(/DELETE\s+FROM\s+SGH_(?:PRECO_AUTORIA|CAD_CONVENIO_PLANO|CAT_CARGA)/i);
    }
    // 0123: a comparação da importação guarda o vigente antes e o nome do item.
    expect(scripts.find((x) => x.numero === 123)?.comandos.slice(0, 2)).toEqual([
      'ALTER TABLE SGH_CAT_CARGA_LINHA ADD VALORES_ANTES VARCHAR(400)',
      'ALTER TABLE SGH_CAT_CARGA_LINHA ADD NOME VARCHAR(120)',
    ]);
  });

  it('M15: índices do registro de acesso e a representação dos formulários só de inclusão (SELECT e INSERT)', () => {
    expect(scripts.find((x) => x.numero === 150)?.comandos).toEqual([
      'CREATE INDEX SGH_IDX_TRILHA_OBJETO ON SGH_TRILHA (HOSPITAL, EVENTO, ID_RICADPAC, DIA)',
      'CREATE INDEX SGH_IDX_TRILHA_USUARIO ON SGH_TRILHA (HOSPITAL, USUARIO, DIA)',
    ]);
    const s = scripts.find((x) => x.numero === 151);
    expect(s?.arquivo).toBe('pep/sgh/0151_pep_form_versao.sql');
    expect(s?.comandos.filter((c) => /^GRANT /.test(c))).toEqual([
      'GRANT SELECT, INSERT ON SGH_PEP_FORM_VERSAO TO ROLE SGH_APLICACAO',
      'GRANT USAGE ON SEQUENCE SGH_GEN_PEP_FORM_VERSAO TO ROLE SGH_APLICACAO',
    ]);
  });

  it('M26: amostra, valor crítico e aviso, versões do resultado, acesso ao portal, orçamento e laudos emitidos; nada com DELETE; eventos, exames da amostra, versões e laudos só de inclusão', () => {
    const doM26 = scripts.filter((x) => x.numero >= 260 && x.numero <= 269);
    expect(doM26.map((x) => x.arquivo)).toEqual([
      'sadt/sgh/0260_sadt_amostra.sql',
      'sadt/sgh/0261_sadt_valor_critico.sql',
      'sadt/sgh/0262_sadt_result_versao.sql',
      'sadt/sgh/0263_sadt_portal_acesso.sql',
      'sadt/sgh/0264_sadt_orcamento.sql',
      'sadt/sgh/0265_sadt_laudo_emitido.sql',
      'sadt/sgh/0266_sadt_laudo_numeracao.sql',
      'sadt/sgh/0267_sadt_laudo_exame.sql',
    ]);
    const grants = doM26.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_AMOSTRA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_AMOSTRA_EXAME TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_AMOSTRA_EVENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_VALOR_CRITICO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_AVISO_CRITICO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_RESULT_VERSAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_RESULT_LEITURA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_PORTAL_ACESSO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_ORCAMENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_LAUDO_EMITIDO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_LAUDO_EXAME TO ROLE SGH_APLICACAO',
    ]);
    expect(doM26.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    // D-LAUDO-26: as sequências da numeração do laudo numa faixa própria, longe da usada pelo outro sistema.
    expect(doM26.find((x) => x.numero === 266)?.comandos.slice(0, 2)).toEqual([
      'CREATE SEQUENCE SGH_GEN_SADT_LAUDO_IMPRESSAO START WITH 1500000000',
      'CREATE SEQUENCE SGH_GEN_SADT_LAUDO_IMP_EXAME START WITH 1500000000',
    ]);
  });

  it('M47 (etapa 3): a lista de trabalho DICOM e os status do estudo só em tabelas SGH_ (FK só entre elas), o número de acesso e a mensagem únicos; nada com DELETE', () => {
    const doM47 = scripts.filter((x) => x.numero >= 477 && x.numero <= 479);
    expect(doM47.map((x) => x.arquivo)).toEqual([
      'sadt/sgh/0477_pacs_mwl.sql',
      'sadt/sgh/0478_pacs_estudo.sql',
      'sadt/sgh/0479_pacs_paciente_e_envio.sql',
    ]);
    const todos = doM47.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_SADT_PACS_MWL',
      'SGH_SADT_PACS_ESTUDO',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_SADT_PACS_MWL_ACC UNIQUE (HOSPITAL, ACCESSION)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_SADT_PACS_MWL_EXAME UNIQUE (HOSPITAL, ID_SILANEXA)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_SADT_PACS_ESTUDO_MSG UNIQUE (HOSPITAL, CHAVE_MENSAGEM)');
    expect(todos).toContain(
      'GRANT UPDATE (ENVIOS, ID_OUTBOX, ULTIMO_ENVIO_EM, ULTIMO_ENVIO_POR) ON SGH_SADT_PACS_MWL TO ROLE SGH_APLICACAO',
    );
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_SADT_PACS_ESTUDO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('ALTER TABLE SGH_SADT_PACS_MWL ADD ID_PACIENTE INTEGER');
    expect(todos).toContain('CREATE INDEX SGH_IDX_INTG_ENVIO_OUTBOX ON SGH_INTG_ENVIO (HOSPITAL, ID_OUTBOX)');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_SADT_PACS_/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M47 (etapa 1): a requisição, a amostra, o ato, os sinais e a reação da agência transfusional só em tabelas SGH_, sem DELETE', () => {
    const doM47 = scripts.filter((x) => x.numero >= 470 && x.numero <= 471);
    expect(doM47.map((x) => x.arquivo)).toEqual([
      'sadt/sgh/0470_hemo_requisicao.sql',
      'sadt/sgh/0471_hemo_ato.sql',
    ]);
    const grants = doM47.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_HEMO_REQ TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_HEMO_AMOSTRA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_HEMO_ATO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SADT_HEMO_ATO_SINAL TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SADT_HEMO_REACAO TO ROLE SGH_APLICACAO',
    ]);
    expect(doM47.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    // Regra 2: a dupla checagem por duas pessoas diferentes vale também no banco.
    expect(
      doM47.flatMap((x) => x.comandos).some((c) => c.includes('UPPER(CONFERENTE) <> UPPER(PROFISSIONAL)')),
    ).toBe(true);
  });

  it('M48 (etapa 1): a notificação de incidentes, a linha do tempo e o sequencial do protocolo só em tabelas SGH_, sem DELETE, com o anonimato garantido no banco', () => {
    const doM48 = scripts.filter((x) => x.numero === 480);
    expect(doM48.map((x) => x.arquivo)).toEqual(['qualidade/sgh/0480_qua_notificacao.sql']);
    const comandos = doM48.flatMap((x) => x.comandos);
    expect(comandos.filter((c) => /^GRANT SELECT/i.test(c))).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_QUA_NOTIF_PROTOCOLO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_QUA_NOTIFICACAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_QUA_NOTIF_EVENTO TO ROLE SGH_APLICACAO',
    ]);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    // Regra 1: a anônima não guarda quem notificou; a identificada sempre guarda.
    expect(comandos.some((c) => c.includes("(ANONIMA = 'N' OR NOTIFICADOR IS NULL)"))).toBe(true);
    // Nenhuma FK para tabela do legado (só a da linha do tempo para a notificação).
    expect(comandos.filter((c) => /REFERENCES/i.test(c)).every((c) => /REFERENCES SGH_/.test(c))).toBe(true);
  });

  it('M48 (etapa 2): análise, plano 5W2H, sugestão resolvida só por resumo e vigilância de produto só em SGH_, FK só entre elas, sem DELETE', () => {
    const doM48 = scripts.filter((x) => x.numero >= 481 && x.numero <= 482);
    expect(doM48.map((x) => x.arquivo)).toEqual([
      'qualidade/sgh/0481_qua_analise.sql',
      'qualidade/sgh/0482_qua_tecnovig.sql',
    ]);
    const todos = doM48.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_QUA_ANALISE',
      'SGH_QUA_PLANO_ACAO',
      'SGH_QUA_SUGESTAO_RESOLVIDA',
      'SGH_QUA_TECNOVIG',
      'SGH_QUA_TECNOVIG_EVENTO',
    ]);
    const comandos = doM48.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    expect(comandos.filter((c) => /REFERENCES/i.test(c)).every((c) => /REFERENCES SGH_/.test(c))).toBe(true);
    // Regra 1: a sugestão resolvida não guarda o login nem a origem (só o resumo e o dia).
    expect(todos).toMatch(/CREATE TABLE SGH_QUA_SUGESTAO_RESOLVIDA \([^;]*RESUMO\s+CHAR\(64\)/);
    expect(todos).not.toMatch(/SGH_QUA_SUGESTAO_RESOLVIDA \([^;]*(USUARIO|LOGIN|ORIGEM)/);
    expect(todos).toContain("'analiseIniciada', 'analiseConcluida'");
  });

  it('M48 (etapa 3, correção 0975): o consumo de preparação alcoólica é único por unidade, setor e competência', () => {
    const c = scripts.filter((x) => x.numero === 975);
    expect(c.map((x) => x.arquivo)).toEqual(['qualidade/sgh/0975_qua_maos_consumo_unico.sql']);
    const comandos = c.flatMap((x) => x.comandos);
    expect(comandos).toHaveLength(1);
    expect(comandos[0]).toMatch(
      /^CREATE UNIQUE INDEX SGH_UQ_QUA_MAOS_CONSUMO ON SGH_QUA_HIGIENE_MAOS COMPUTED BY/,
    );
    expect(comandos[0]).toContain("CASE WHEN TIPO = 'consumo' THEN");
  });

  it('M48 (etapa 3): a CCIH só em tabelas SGH_ (FK só entre elas), sem DELETE, uma decisão por item prescrito', () => {
    const doM48 = scripts.filter((x) => x.numero === 483);
    expect(doM48.map((x) => x.arquivo)).toEqual(['qualidade/sgh/0483_qua_ccih.sql']);
    const todos = doM48.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_QUA_DISPOSITIVO',
      'SGH_QUA_IRAS',
      'SGH_QUA_ANTIMICRO_ITEM',
      'SGH_QUA_ANTIMICRO_LIB',
      'SGH_QUA_PRECAUCAO',
      'SGH_QUA_HIGIENE_MAOS',
      'SGH_QUA_SURTO',
    ]);
    const comandos = doM48.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    expect(comandos.filter((c) => /REFERENCES/i.test(c)).every((c) => /REFERENCES SGH_/.test(c))).toBe(true);
    expect(todos).toContain('CONSTRAINT SGH_UQ_QUA_ATM_LIB_ITEM UNIQUE (HOSPITAL, ID_PRLANGERAL)');
    // A observação de higiene das mãos não identifica quem foi observado (só a categoria).
    expect(todos).not.toMatch(/SGH_QUA_HIGIENE_MAOS \([^;]*(OBSERVADO_POR|PROFISSIONAL|LOGIN_OBSERVADO)/);
  });

  it('M48 (etapa 4): o caso de agravo e os gatilhos de exame só em tabelas SGH_, sem DELETE nem FK, um caso por gatilho', () => {
    const doM48 = scripts.filter((x) => x.numero === 484);
    expect(doM48.map((x) => x.arquivo)).toEqual(['qualidade/sgh/0484_qua_agravo.sql']);
    const todos = doM48.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_QUA_AGRAVO_CASO',
      'SGH_QUA_AGRAVO_EXAME',
    ]);
    const comandos = doM48.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    expect(comandos.some((c) => /REFERENCES/i.test(c))).toBe(false);
    expect(todos).toContain('CONSTRAINT SGH_UQ_QUA_AGRAVO_GATILHO UNIQUE (HOSPITAL, CHAVE_GATILHO)');
    // Sem nome de paciente nem de notificador: só o ID do paciente e logins de operador.
    expect(todos).not.toMatch(/SGH_QUA_AGRAVO_CASO \([^;]*\b(NOME|NOME_PACIENTE|MAE)\b/);
  });

  it('M48 (etapa 5): a gestão da qualidade e os envios regulatórios só em tabelas SGH_, FK só entre elas, sem DELETE; aprovador diferente do elaborador e pontuação GUT pelo CHECK', () => {
    const doM48 = scripts.filter((x) => x.numero === 485 || x.numero === 486);
    expect(doM48.map((x) => x.arquivo)).toEqual([
      'qualidade/sgh/0485_qua_gestao_qualidade.sql',
      'qualidade/sgh/0486_qua_envio_regulatorio.sql',
    ]);
    const todos = doM48.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_QUA_DOCUMENTO',
      'SGH_QUA_DOC_CIENCIA',
      'SGH_QUA_IND_ANALISE',
      'SGH_QUA_AUDITORIA',
      'SGH_QUA_COMISSAO',
      'SGH_QUA_COMISSAO_REUNIAO',
      'SGH_QUA_RISCO',
      'SGH_QUA_NAO_CONFORM',
      'SGH_QUA_OUVIDORIA',
      'SGH_QUA_ENVIO_REG',
    ]);
    const comandos = doM48.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_QUA_/);
    expect(todos).toContain('CHECK (APROVADO_POR <> ELABORADO_POR)');
    expect(todos).toContain('PONTUACAO = GRAVIDADE * URGENCIA * TENDENCIA');
  });

  it('M47 (etapa 2): a imuno-hematologia, o estoque de bolsas e o histórico da bolsa só em tabelas SGH_ (FK só entre elas), a liberação por outra pessoa e o número da bolsa único; sem DELETE', () => {
    const doM47 = scripts.filter((x) => x.numero >= 472 && x.numero <= 476);
    expect(doM47.map((x) => x.arquivo)).toEqual([
      'sadt/sgh/0472_hemo_imuno.sql',
      'sadt/sgh/0473_hemo_bolsa.sql',
    ]);
    const todos = doM47.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_SADT_HEMO_IMUNO',
      'SGH_SADT_HEMO_BOLSA',
      'SGH_SADT_HEMO_BOLSA_MOV',
    ]);
    expect(todos).toContain('UPPER(LIBERADO_POR) <> UPPER(REGISTRADO_POR)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_SADT_HEMO_BOLSA_NUM UNIQUE (HOSPITAL, NUMERO)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_SADT_HEMO_BOLSA_MOV TO ROLE SGH_APLICACAO');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_SADT_HEMO_/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M50 (etapa 3): as chaves únicas do portal do M26 corrigidas, o vínculo do médico externo e o pedido do portal só em tabelas SGH_, sem DELETE', () => {
    const doM50e3 = scripts.filter((x) => x.numero === 508 || x.numero === 509);
    expect(doM50e3.map((x) => x.arquivo)).toEqual([
      'sadt/sgh/0508_sadt_portal_chaves_unicas.sql',
      'sadt/sgh/0509_portal_medico_externo.sql',
    ]);
    const comandos = doM50e3.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b|DROP\s+(TABLE|INDEX)|REFERENCES/i.test(c))).toBe(false);
    for (const c of comandos)
      expect(c).toMatch(
        /^(ALTER TABLE SGH_(SADT_PORTAL_ACESSO|CC_AGENDA_ESTADO) ADD \w+ (INTEGER|BIGINT|TIMESTAMP|DATE|VARCHAR\(\d+\))|CREATE INDEX SGH_IDX_(SADT_PORTAL_PROFIS|CC_ESTADO_PORTAL) ON SGH_(SADT_PORTAL_ACESSO|CC_AGENDA_ESTADO) \(.+\)|ALTER TABLE SGH_SADT_PORTAL_ACESSO (DROP CONSTRAINT SGH_UQ_SADT_PORTAL_(PROT|MED)|ADD CONSTRAINT SGH_UQ_SADT_PORTAL_PROTOCOLO UNIQUE \(PROTOCOLO_RESUMO\))|CREATE UNIQUE INDEX SGH_UQ_SADT_PORTAL_CONSELHO ON SGH_SADT_PORTAL_ACESSO COMPUTED BY \(.+\))$/,
      );
  });

  it('M55 (etapa 1): manutenção e engenharia clínica só em tabelas SGH_MAN_ novas, na ordem das FKs; nenhuma GM* do outro sistema, nenhum DELETE', () => {
    const doM55e1 = scripts.filter((x) => x.numero >= 550 && x.numero <= 553);
    expect(doM55e1.map((x) => x.arquivo)).toEqual([
      'manutencao/sgh/0550_man_equipamento.sql',
      'manutencao/sgh/0551_man_cobertura.sql',
      'manutencao/sgh/0552_man_os.sql',
      'manutencao/sgh/0553_man_preventiva.sql',
    ]);
    const todos = doM55e1.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_MAN_EQUIPAMENTO',
      'SGH_MAN_COBERTURA',
      'SGH_MAN_COBERTURA_EQUIP',
      'SGH_MAN_OS',
      'SGH_MAN_OS_EVENTO',
      'SGH_MAN_PREVENTIVA',
      'SGH_MAN_PREVENTIVA_EXEC',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_MAN_EQUIP_CODIGO UNIQUE (HOSPITAL, CODIGO)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_OS_EVENTO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_PREVENTIVA_EXEC TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|DROP\s+(TABLE|INDEX)|ALTER TABLE/);
    expect(todos).not.toMatch(/\bGM[A-Z]+\b/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_MAN_/);
    for (const m of todos.matchAll(/(?:CONSTRAINT|INDEX|SEQUENCE|TABLE) (SGH_\w+)/g))
      expect(m[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M55 (etapa 2): a rouparia e a lavanderia só com objetos SGH_; nada com DELETE nem FK para o legado', () => {
    const doM55e2 = scripts.filter((x) => x.numero === 556);
    expect(doM55e2.map((x) => x.arquivo)).toEqual(['internacao/sgh/0556_hot_roupa_movimento.sql']);
    const todos = doM55e2.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_HOT_ROUPA_PECA',
      'SGH_HOT_ROUPA_COTA',
      'SGH_HOT_ROUPA_MOVIMENTO',
      'SGH_HOT_ROUPA_MOV_ITEM',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_ROUPA_MOV_CHAVE UNIQUE (HOSPITAL, CHAVE)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_HOT_ROUPA_MOV_ITEM TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|DROP\s+(TABLE|INDEX)/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_HOT_ROUPA_/);
    for (const m of todos.matchAll(/(?:CONSTRAINT|INDEX|SEQUENCE|TABLE) (SGH_\w+)/g))
      expect(m[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M50 (etapa 6): a assinatura do digitalizador no serviço do M49, a agenda de sessões com a trava e a digitalização só com objetos SGH_; nada com DELETE nem FK para o legado', () => {
    const doM50e6 = scripts.filter((x) => x.numero >= 965 && x.numero <= 967);
    expect(doM50e6.map((x) => x.arquivo)).toEqual([
      'documento/sgh/0965_doc_assinatura_digitalizacao.sql',
      'agenda/sgh/0966_sessao.sql',
      'internacao/sgh/0967_digitalizacao.sql',
    ]);
    const todos = doM50e6.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_AGE_SESSAO',
      'SGH_AGE_SESSAO_TRAVA',
      'SGH_HOT_DIGITALIZACAO',
    ]);
    // As restrições do M49 saem e voltam com o valor novo (as colunas de 10 para 16 caracteres).
    for (const c of doM50e6[0]!.comandos)
      expect(c).toMatch(
        /^ALTER TABLE SGH_DOC_(PEDIDO_ASSINATURA|ASSINATURA) (DROP CONSTRAINT SGH_CK_DOC_(PEDIDO_FINALIDADE|ASSIN_ORIGEM)|ALTER COLUMN (FINALIDADE|ORIGEM) TYPE VARCHAR\(16\)|ADD CONSTRAINT SGH_CK_DOC_(PEDIDO_FINALIDADE|ASSIN_ORIGEM) CHECK .+'digitalizacao'.+)$/,
      );
    expect(todos).toContain("CONSTRAINT SGH_CK_HOT_DIGIT_DESTINACAO CHECK (DESTINACAO = 'guardar')");
    expect(todos).toContain(
      'CONSTRAINT SGH_CK_HOT_DIGIT_IMAGEM CHECK (RESOLUCAO_DPI >= 300 AND PAGINAS > 0 AND TAMANHO > 0)',
    );
    expect(todos).toContain('CONSTRAINT SGH_UQ_AGE_SESSAO_ORDEM UNIQUE (SERIE, ORDEM)');
    expect(todos).not.toMatch(/\bDELETE\b|DROP\s+(TABLE|INDEX)/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M50 (etapa 4): a teleconsulta e a teleinterconsulta só em SGH_ATD_TELECONSULTA, sem DELETE nem FK; a agenda online só ganha a oferta da teleconsulta', () => {
    const doM50e4 = scripts.filter((x) => x.numero === 954);
    expect(doM50e4.map((x) => x.arquivo)).toEqual(['atendimento/sgh/0954_teleconsulta.sql']);
    const comandos = doM50e4.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b|DROP\s+|REFERENCES/i.test(c))).toBe(false);
    expect(
      comandos.filter((c) => /^CREATE TABLE/i.test(c)).map((c) => /^CREATE TABLE (\w+)/i.exec(c)?.[1]),
    ).toEqual(['SGH_ATD_TELECONSULTA']);
    expect(comandos.filter((c) => /^GRANT /i.test(c))).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_ATD_TELECONSULTA TO ROLE SGH_APLICACAO',
      'GRANT USAGE ON SEQUENCE SGH_GEN_ATD_TELECONSULTA TO ROLE SGH_APLICACAO',
    ]);
    expect(comandos.filter((c) => /^ALTER TABLE/i.test(c))).toEqual([
      "ALTER TABLE SGH_AGE_ONLINE_CFG ADD TELECONSULTA CHAR(1) DEFAULT 'N' NOT NULL",
      "ALTER TABLE SGH_AGE_ONLINE_CFG ADD CONSTRAINT SGH_CK_AGE_ONLINE_TELE CHECK (TELECONSULTA IN ('S', 'N') AND (TELECONSULTA = 'N' OR TIPO = 'consulta'))",
    ]);
    // Uma teleconsulta viva por marcação (a cancelada sai do índice).
    expect(comandos.find((c) => /SGH_UQ_ATD_TELE_MARCACAO/.test(c))).toMatch(
      /^CREATE UNIQUE INDEX SGH_UQ_ATD_TELE_MARCACAO ON SGH_ATD_TELECONSULTA COMPUTED BY \(CASE WHEN MODALIDADE = 'teleconsulta' AND SITUACAO <> 'cancelada' THEN/,
    );
  });

  it('M50 (etapa 4, correção): o 0974 só cria o índice da leitura pelo cabeçalho do atendimento', () => {
    const s974 = scripts.filter((x) => x.numero === 974);
    expect(s974.map((x) => x.arquivo)).toEqual(['atendimento/sgh/0974_teleconsulta_cabecalho.sql']);
    expect(s974.flatMap((x) => x.comandos)).toEqual([
      'CREATE INDEX SGH_IDX_ATD_TELE_CABECALHO ON SGH_ATD_TELECONSULTA (HOSPITAL, ID_ATCABECATEND)',
    ]);
  });

  it('M50 (etapa 1): conta do portal e responsáveis só com objetos SGH_, sem DELETE; a origem do portal só em tabelas SGH_', () => {
    const doM50 = scripts.filter((x) => x.numero >= 500 && x.numero <= 502);
    expect(doM50.map((x) => x.arquivo)).toEqual([
      'cadastro/sgh/0500_portal_conta.sql',
      'cadastro/sgh/0501_portal_responsavel.sql',
      'cadastro/sgh/0502_portal_origem.sql',
    ]);
    const comandos = doM50.flatMap((x) => x.comandos);
    expect(comandos.filter((c) => /^GRANT SELECT/i.test(c))).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_POR_CONTA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_POR_RESPONSAVEL TO ROLE SGH_APLICACAO',
    ]);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    for (const c of comandos.filter((x) => /^ALTER TABLE/i.test(x)))
      expect(c).toMatch(/^ALTER TABLE SGH_(CAD_CONSENTIMENTO|AUD_PEDIDO_TITULAR) ADD /);
    for (const c of comandos)
      for (const ref of c.matchAll(/REFERENCES\s+(\w+)/g)) expect(ref[1]).toMatch(/^SGH_/);
  });

  it('M51 (etapas 1 a 4): competência SUS, crítica, arquivo, CIHA, equivalência, BPA, APAC, AIH e retorno só com objetos SGH_, sem DELETE; o ALTER só na correção da equivalência', () => {
    const doM51 = scripts.filter((x) => x.numero >= 510 && x.numero <= 519);
    expect(doM51.map((x) => x.arquivo)).toEqual([
      'faturamento/sgh/0510_sus_competencia.sql',
      'faturamento/sgh/0511_sus_critica.sql',
      'faturamento/sgh/0512_sus_arquivo.sql',
      'faturamento/sgh/0513_sus_ciha.sql',
      'faturamento/sgh/0514_sus_equivalencia.sql',
      'faturamento/sgh/0515_sus_equivalencia_procedimento.sql',
      'faturamento/sgh/0516_sus_bpa.sql',
      'faturamento/sgh/0517_sus_apac.sql',
      'faturamento/sgh/0518_sus_aih.sql',
      'faturamento/sgh/0519_sus_retorno.sql',
    ]);
    const comandos = doM51.flatMap((x) => x.comandos);
    // A correção 0515 só altera a equivalência do próprio marco (a chave pelo procedimento unificado e a desativação).
    expect(
      comandos
        .filter((c) => /^ALTER\b/i.test(c))
        .every((c) => /^ALTER TABLE SGH_FAT_SUS_EQUIVALENCIA\b/i.test(c)),
    ).toBe(true);
    expect(
      comandos.filter((c) => /^CREATE TABLE/i.test(c)).map((c) => /^CREATE TABLE (\w+)/i.exec(c)?.[1]),
    ).toEqual([
      'SGH_FAT_SUS_COMPETENCIA',
      'SGH_FAT_SUS_CRITICA',
      'SGH_FAT_SUS_ARQUIVO',
      'SGH_FAT_SUS_CIHA',
      'SGH_FAT_SUS_EQUIVALENCIA',
      'SGH_FAT_SUS_BPA',
      'SGH_FAT_SUS_APAC',
      'SGH_FAT_SUS_APAC_ITEM',
      'SGH_FAT_SUS_FAIXA_AIH',
      'SGH_FAT_SUS_AIH',
      'SGH_FAT_SUS_AIH_ITEM',
      'SGH_FAT_SUS_RETORNO',
    ]);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    // A linha do arquivo da APAC não guarda documento nem nome; a APAC guarda só o CNS do autorizador do gestor e a
    // chave do solicitante (FAMEDSOL), que o arquivo exige, nunca documento do paciente.
    const item = comandos.find((c) => /^CREATE TABLE SGH_FAT_SUS_APAC_ITEM\b/i.test(c)) ?? '';
    expect(item).not.toMatch(/\b(CNS|CPF|NASC|NOME|ENDERECO|CEP)\b/i);
    const apac = comandos.find((c) => /^CREATE TABLE SGH_FAT_SUS_APAC\b/i.test(c)) ?? '';
    expect(apac).not.toMatch(/\b(CNS|CPF|NASC|NOME|ENDERECO|CEP|CNS_PACIENTE|CPF_PACIENTE)\b/i);
    // A AIH, as linhas dela e o retorno não guardam documento nem nome do paciente: só o CPF do médico solicitante
    // (a chave do FAMEDSOL) e o CNS do autorizador do gestor, que vão ao arquivo.
    for (const t of [
      'SGH_FAT_SUS_AIH',
      'SGH_FAT_SUS_AIH_ITEM',
      'SGH_FAT_SUS_RETORNO',
      'SGH_FAT_SUS_FAIXA_AIH',
    ]) {
      const c = comandos.find((x) => new RegExp(`^CREATE TABLE ${t}\\b`, 'i').test(x)) ?? '';
      expect(c.length).toBeGreaterThan(0);
      expect(c.replace(/\bCPF_SOLICITANTE\b|\bCNS_AUTORIZADOR\b/g, '')).not.toMatch(
        /\b(CNS|CPF|NASC|NOME|ENDERECO|CEP)\w*\b/i,
      );
    }
    // A linha do BPA também não guarda documento nem nome (do paciente ou do profissional).
    const bpa = comandos.find((c) => /^CREATE TABLE SGH_FAT_SUS_BPA\b/i.test(c)) ?? '';
    expect(bpa).not.toMatch(/\b(CNS|CPF|NASC|NOME|ENDERECO|CEP)\b/i);
    // O registro da CIHA não guarda documento nem nome do paciente (só o arquivo guardado tem).
    const ciha = comandos.find((c) => /^CREATE TABLE SGH_FAT_SUS_CIHA\b/i.test(c)) ?? '';
    expect(ciha).not.toMatch(/\b(CNS|CPF|NASC|NOME|ENDERECO|CEP)\b/i);
  });

  it('M50 (etapa 2): agenda online, pré-check-in, pagamento e pesquisa só com objetos SGH_, sem DELETE; o caixa do M30 só ganha o conector do gateway', () => {
    const doM50 = scripts.filter((x) => x.numero >= 503 && x.numero <= 507);
    expect(doM50.map((x) => x.arquivo)).toEqual([
      'agenda/sgh/0503_agenda_online.sql',
      'agenda/sgh/0504_precheckin.sql',
      'faturamento/sgh/0505_portal_pagamento.sql',
      'cadastro/sgh/0506_portal_pesquisa.sql',
      'faturamento/sgh/0507_portal_pagamento_unico.sql',
    ]);
    const comandos = doM50.flatMap((x) => x.comandos);
    expect(
      comandos.filter((c) => /^CREATE TABLE/i.test(c)).map((c) => /^CREATE TABLE (\w+)/i.exec(c)?.[1]),
    ).toEqual(['SGH_AGE_ONLINE_CFG', 'SGH_POR_PRECHECKIN', 'SGH_POR_PAGAMENTO', 'SGH_POR_PESQUISA']);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    expect(comandos.filter((c) => /^ALTER TABLE/i.test(c))).toEqual([
      'ALTER TABLE SGH_FAT_PAGAMENTO DROP CONSTRAINT SGH_CK_FAT_PAGAMENTO_CONECTOR',
      "ALTER TABLE SGH_FAT_PAGAMENTO ADD CONSTRAINT SGH_CK_FAT_PAGAMENTO_CONECTOR CHECK (CONECTOR IN ('simulado', 'manual', 'dinheiro', 'gateway'))",
      // 0507 (correção da revisão): o Pix e o cartão na intenção, a situação 'duplicado' e o seu CHECK.
      'ALTER TABLE SGH_POR_PAGAMENTO ADD PIX_COPIA_COLA VARCHAR(1000)',
      'ALTER TABLE SGH_POR_PAGAMENTO ADD ENDERECO_CARTAO VARCHAR(400)',
      'ALTER TABLE SGH_POR_PAGAMENTO DROP CONSTRAINT SGH_CK_POR_PAGAMENTO_SIT',
      "ALTER TABLE SGH_POR_PAGAMENTO ADD CONSTRAINT SGH_CK_POR_PAGAMENTO_SIT CHECK (SITUACAO IN ('pendente', 'confirmado', 'recusado', 'expirado', 'duplicado'))",
      "ALTER TABLE SGH_POR_PAGAMENTO ADD CONSTRAINT SGH_CK_POR_PAGAMENTO_DUP CHECK (SITUACAO <> 'duplicado' OR (ID_FAT_PAGAMENTO IS NOT NULL AND CONFIRMADO_EM IS NOT NULL))",
    ]);
    // Uma intenção pendente ou confirmada por marcação e um caixa aberto do portal (índices únicos por expressão).
    expect(
      comandos
        .filter((c) => /^CREATE UNIQUE INDEX/i.test(c))
        .map((c) => /INDEX (\w+) ON (\w+)/.exec(c)?.slice(1)),
    ).toEqual([
      ['SGH_UQ_POR_PAGAMENTO_ABERTO', 'SGH_POR_PAGAMENTO'],
      ['SGH_UQ_FAT_CAIXA_PORTAL', 'SGH_FAT_CAIXA'],
    ]);
    for (const c of comandos)
      for (const ref of c.matchAll(/REFERENCES\s+(\w+)/g)) expect(ref[1]).toMatch(/^SGH_/);
  });

  it('M27: mensagem com destinatários e avisos da central; só objetos SGH_, nada com DELETE', () => {
    const doM27 = scripts.filter((x) => x.numero >= 270 && x.numero <= 279);
    expect(doM27.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/0270_adm_mensagem.sql',
      'acesso/sgh/0271_adm_aviso.sql',
    ]);
    const comandos = doM27.flatMap((x) => x.comandos);
    expect(comandos.some((c) => /\bDELETE\b/i.test(c) && /^GRANT/i.test(c))).toBe(false);
    for (const c of comandos.filter((x) => /^CREATE TABLE/i.test(x)))
      expect(c).toMatch(/^CREATE TABLE SGH_ADM_/i);
  });

  it('M21: as 6 tabelas da internação, dos leitos, da higienização e do SAME; nada com DELETE; etapas e SAME só de inclusão', () => {
    const doM21 = scripts.filter((x) => x.numero >= 210 && x.numero <= 219);
    expect(doM21.map((x) => x.arquivo)).toEqual([
      'internacao/sgh/0210_alta_medica.sql',
      'internacao/sgh/0211_encaminhamento.sql',
      'internacao/sgh/0212_leito_estado.sql',
      'internacao/sgh/0213_leito_atributo.sql',
      'internacao/sgh/0214_limpeza_etapa.sql',
      'internacao/sgh/0215_same_ext.sql',
    ]);
    const grants = doM21.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_INT_ALTA_MEDICA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_INT_ENCAMINHAMENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_INT_LEITO_ESTADO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_INT_LEITO_ATRIBUTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_HOT_LIMPEZA_ETAPA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_HOT_SAME_EXT TO ROLE SGH_APLICACAO',
    ]);
    for (const g of grants) expect(g).not.toMatch(/DELETE/);
  });

  it('M25: as 9 tabelas da beira do leito; nada com DELETE; a resolução do conflito, o aceite do plantão e o aparelho as únicas alterações', () => {
    const doM25 = scripts.filter((x) => x.numero >= 250 && x.numero <= 259);
    expect(doM25.map((x) => x.arquivo)).toEqual([
      'enfermagem/sgh/0250_checagem_ext.sql',
      'enfermagem/sgh/0251_infusao_evento.sql',
      'enfermagem/sgh/0252_sinal_vital.sql',
      'enfermagem/sgh/0253_aprazamento.sql',
      'enfermagem/sgh/0254_conflito_sync.sql',
      'enfermagem/sgh/0255_passagem_plantao.sql',
      'enfermagem/sgh/0256_dispositivo.sql',
      'pep/sgh/0257_pep_resp_ext.sql',
    ]);
    const grants = doM25.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT ON SGH_PEP_CHECAGEM_EXT TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_INFUSAO_EVENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_SINAL_VITAL TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_APRAZAMENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_PEP_CONFLITO_SYNC TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_PEP_PASSAGEM_PLANTAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_PASSAGEM_NOTA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_PEP_DISPOSITIVO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_RESP_EXT TO ROLE SGH_APLICACAO',
    ]);
    expect(doM25.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
  });
  it('M29: as 7 tabelas da farmácia; nada com DELETE; só a avaliação e a intervenção mudam (a decisão e a resposta)', () => {
    const doM29 = scripts.filter((x) => x.numero >= 290 && x.numero <= 299);
    expect(doM29.map((x) => x.arquivo)).toEqual([
      'suprimentos/sgh/0290_sup_avaliacao_farm.sql',
      'suprimentos/sgh/0291_sup_intervencao_farm.sql',
      'suprimentos/sgh/0292_sup_entrega_aceite.sql',
      'suprimentos/sgh/0293_sup_controlado_conf.sql',
      'suprimentos/sgh/0294_sup_livro_controlado.sql',
      'suprimentos/sgh/0295_sup_farm_amb_dispensacao.sql',
      'suprimentos/sgh/0296_sup_sngpc_escrituracao.sql',
    ]);
    const grants = doM29.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_SUP_AVALIACAO_FARM TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_SUP_INTERVENCAO_FARM TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SUP_ENTREGA_ACEITE TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SUP_CONTROLADO_CONF TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SUP_LIVRO_CONTROLADO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SUP_FARM_AMB_DISPENSACAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_SUP_SNGPC_ESCRITURACAO TO ROLE SGH_APLICACAO',
    ]);
    expect(doM29.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
  });
  it('M34: triagem, agendamento, execução e pedido de relatório; parceiro, envio, entrada e marca das integrações; nada com DELETE; a execução só de inclusão; o envio e a entrada só mudam as colunas de controle', () => {
    const doM34 = scripts.filter((x) => x.numero >= 340 && x.numero <= 349);
    expect(doM34.map((x) => x.arquivo)).toEqual([
      'relatorio/sgh/0340_rel_triagem.sql',
      'relatorio/sgh/0341_rel_agendamento.sql',
      'relatorio/sgh/0342_rel_execucao.sql',
      'relatorio/sgh/0343_rel_pedido.sql',
      'integracao/sgh/0344_intg_parceiro.sql',
      'integracao/sgh/0345_intg_envio.sql',
      'integracao/sgh/0346_intg_recebida.sql',
      'integracao/sgh/0347_intg_marca_fato.sql',
    ]);
    const grants = doM34.flatMap((x) => x.comandos).filter((c) => /^GRANT (SELECT|UPDATE)/i.test(c));
    expect(grants.map((g) => g.replace(/\(.*\)/, '(…)'))).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_REL_TRIAGEM TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_REL_AGENDAMENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_REL_EXECUCAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_REL_PEDIDO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_INTG_PARCEIRO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_INTG_ENVIO TO ROLE SGH_APLICACAO',
      'GRANT UPDATE (…) ON SGH_INTG_ENVIO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_INTG_RECEBIDA TO ROLE SGH_APLICACAO',
      'GRANT UPDATE (…) ON SGH_INTG_RECEBIDA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_INTG_MARCA_FATO TO ROLE SGH_APLICACAO',
    ]);
    expect(doM34.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    // Regra 8: o consumidor e a entrada idempotentes pela chave (evento + parceiro; chave do parceiro).
    const todos = doM34.flatMap((x) => x.comandos).join('\n');
    expect(todos).toContain('CONSTRAINT SGH_UQ_INTG_ENVIO_EVENTO UNIQUE (HOSPITAL, CHAVE_EVENTO, PARCEIRO)');
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_INTG_RECEBIDA_CHAVE UNIQUE (HOSPITAL, PARCEIRO, CHAVE_PARCEIRO)',
    );
    // Regra 4: exportação com dado pessoal sem máscara exige a justificativa (no banco também).
    expect(todos).toMatch(
      /SGH_CK_REL_EXEC_JUSTIF CHECK \(TIPO <> 'exportacao' OR DADO_PESSOAL = 'N' OR MASCARADO = 'S' OR JUSTIFICATIVA IS NOT NULL\)/,
    );
  });

  it('M38: a vigilância diária de gravação em produção (só estrutura); nada com DELETE', () => {
    const doM38 = scripts.filter((x) => x.numero >= 380 && x.numero <= 389);
    expect(doM38.map((x) => x.arquivo)).toEqual(['config/sgh/0380_coex_vigia.sql']);
    const todos = doM38.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CFG_COEX_VIGIA',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_PK_CFG_COEX_VIGIA PRIMARY KEY (HOSPITAL, DIA, OPERACAO)');
    expect(todos).toContain('DIVERGENTES <= AMOSTRADAS');
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M43: colunas novas anuláveis no dispositivo do M19 e na conclusão do M37, e só a tabela de trava do login substituído; nada com DELETE nem DROP', () => {
    const doM43 = scripts.filter((x) => x.numero >= 430 && x.numero <= 439);
    expect(doM43.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/0430_dispositivo_substitui.sql',
      'acesso/sgh/0431_dispositivo_subst_trava.sql',
      'config/sgh/0432_coex_treino_turno.sql',
    ]);
    const todos = doM43.flatMap((x) => x.comandos);
    expect(todos.join('\n')).not.toMatch(/DELETE|DROP/);
    expect([...todos.join('\n').matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_ACESSO_DISP_SUBST_TRAVA',
    ]);
    expect(doM43[0]!.comandos).toEqual([
      'ALTER TABLE SGH_ACESSO_DISPOSITIVO ADD LOGIN_SUBSTITUIDO VARCHAR(31)',
      'ALTER TABLE SGH_ACESSO_DISPOSITIVO ADD CONFERIDO_EM TIMESTAMP',
      'ALTER TABLE SGH_ACESSO_DISPOSITIVO ADD CONFERIDO_POR VARCHAR(31)',
      'CREATE INDEX SGH_IDX_ACESSO_DISP_SUBST ON SGH_ACESSO_DISPOSITIVO (HOSPITAL, LOGIN_SUBSTITUIDO)',
    ]);
    expect(doM43[1]!.comandos.join('\n')).toContain(
      'CONSTRAINT SGH_PK_ACESSO_DISP_SUBST_TRAVA PRIMARY KEY (HOSPITAL, LOGIN_SUBSTITUIDO)',
    );
    // A coluna nova da conclusão é anulável (a conclusão antiga fica sem turno).
    expect(doM43[2]!.comandos[0]).toBe('ALTER TABLE SGH_CFG_COEX_TREINO ADD TURNO VARCHAR(14)');
  });

  it('M53 (etapas 1, 3, 4, 5 e 6): lotes da folha externa, resumo, afastamento, salário, parâmetros, cálculo, férias, rescisão e eSocial; a correção 0532 só troca o CHECK da competência, a 0536 só acrescenta o tipo e o pagamento ao processamento e a 0538 só alarga o CHECK do tipo', () => {
    const doM53 = scripts.filter((x) => x.numero >= 530 && x.numero <= 539);
    expect(doM53.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0530_pes_folha_interface.sql',
      'pessoas/sgh/0531_pes_afastamento.sql',
      'pessoas/sgh/0532_pes_folha_interface_competencia.sql',
      'pessoas/sgh/0533_pes_salario.sql',
      'pessoas/sgh/0534_pes_folha_parametro.sql',
      'pessoas/sgh/0535_pes_folha_processo.sql',
      'pessoas/sgh/0536_pes_folha_processo_tipo.sql',
      'pessoas/sgh/0537_pes_ferias.sql',
      'pessoas/sgh/0538_pes_rescisao.sql',
      'pessoas/sgh/0539_pes_esocial.sql',
    ]);
    const todos = doM53.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_FOLHA_INTERFACE',
      'SGH_PES_FOLHA_RESUMO',
      'SGH_PES_AFASTAMENTO',
      'SGH_PES_SALARIO',
      'SGH_PES_FOLHA_PARAMETRO',
      'SGH_PES_FOLHA_PROCESSO',
      'SGH_PES_FOLHA_CALCULO',
      'SGH_PES_FERIAS',
      'SGH_PES_RESCISAO',
      'SGH_PES_ESOCIAL_EMPREGADOR',
      'SGH_PES_ESOCIAL_FICHA',
      'SGH_PES_ESOCIAL_LOTE',
      'SGH_PES_ESOCIAL_EVENTO',
      'SGH_PES_ESOCIAL_CONCILIA',
    ]);
    // 0539: só tabelas novas do eSocial; nenhuma FPESOC do outro sistema, nenhum DELETE.
    expect(doM53[9]!.comandos.join('\n')).not.toMatch(/FPESOC|DELETE|DROP/);
    // 0996 (correção fora da faixa): só troca o CHECK do início da vigência por um sem SIMILAR TO.
    const c996 = scripts.find((x) => x.numero === 996)!;
    expect(c996.arquivo).toBe('pessoas/sgh/0996_pes_esocial_inicio.sql');
    expect(c996.comandos[0]).toBe(
      'ALTER TABLE SGH_PES_ESOCIAL_EMPREGADOR DROP CONSTRAINT SGH_CK_PES_ESOCIAL_EMPR_INICIO',
    );
    expect(c996.comandos.join('\n')).not.toMatch(/SIMILAR/);
    // 0997 (M53.7, fora da faixa): o fechamento do período da folha e os periódicos no CHECK do evento; sem DELETE.
    const c997 = scripts.find((x) => x.numero === 997)!;
    expect(c997.arquivo).toBe('pessoas/sgh/0997_pes_folha_fechamento.sql');
    const t997 = c997.comandos.join('\n');
    expect([...t997.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_FOLHA_FECHAMENTO',
    ]);
    expect(t997).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PES_FOLHA_FECHAMENTO TO ROLE SGH_APLICACAO');
    expect(t997).toContain("'S-1200', 'S-1210', 'S-1298', 'S-1299'");
    expect(t997).not.toMatch(/SIMILAR|DELETE|FPESOC|FPCABEC|FPFUNC/);
    // 0998 (M53.7, correção da revisão): a linha-guarda do período da folha, que serializa o fechamento e o cálculo.
    const c998 = scripts.find((x) => x.numero === 998)!;
    expect(c998.arquivo).toBe('pessoas/sgh/0998_pes_folha_periodo_trava.sql');
    const t998 = c998.comandos.join('\n');
    expect([...t998.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_FOLHA_PERIODO_TRAVA',
    ]);
    expect(t998).toContain('PRIMARY KEY (HOSPITAL, COD_EMP, APURACAO, PERIODO)');
    expect(t998).toContain(
      'GRANT SELECT, INSERT, UPDATE ON SGH_PES_FOLHA_PERIODO_TRAVA TO ROLE SGH_APLICACAO',
    );
    expect(t998).not.toMatch(/SIMILAR|DELETE|FPESOC|FPCABEC|FPFUNC/);
    // 0999 (M53.8, fora da faixa): os parâmetros das obrigações (só INSERT) e a obrigação gerada com o arquivo cifrado.
    const c999 = scripts.find((x) => x.numero === 999)!;
    expect(c999.arquivo).toBe('pessoas/sgh/0999_pes_obrigacao.sql');
    const t999 = c999.comandos.join('\n');
    expect([...t999.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_OBRIGACAO_PARAM',
      'SGH_PES_OBRIGACAO',
    ]);
    expect(t999).toContain('GRANT SELECT, INSERT ON SGH_PES_OBRIGACAO_PARAM TO ROLE SGH_APLICACAO');
    expect(t999).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PES_OBRIGACAO TO ROLE SGH_APLICACAO');
    expect(t999).toContain('UNIQUE (HOSPITAL, COD_EMP, TIPO, PERIODO, NUMERO)');
    expect(t999).not.toMatch(/SIMILAR|DELETE|DROP|FPESOC|FPCABEC|FPFUNC/);
    // 0981 (M53.9, fora da faixa): o de-para, o lançamento, os títulos e os fatos da folha; nada do outro sistema.
    const c981 = scripts.find((x) => x.numero === 981)!;
    expect(c981.arquivo).toBe('pessoas/sgh/0981_pes_folha_titulos.sql');
    const t981 = c981.comandos.join('\n');
    expect([...t981.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_FOLHA_INTEGRACAO',
      'SGH_PES_FOLHA_LANCAMENTO',
      'SGH_PES_FOLHA_TITULO',
      'SGH_PES_FOLHA_FATO',
    ]);
    expect(t981).toContain(
      'CONSTRAINT SGH_UQ_PES_FOLHA_TIT_CHAVE UNIQUE (HOSPITAL, COD_EMP, APURACAO, PERIODO, DESTINO, VENCIMENTO)',
    );
    expect(t981).toContain('CONSTRAINT SGH_UQ_PES_FOLHA_LANC_ORIG UNIQUE (HOSPITAL, ORIGEM, ID_ORIGEM)');
    expect(t981).not.toMatch(/DELETE|DROP|MFCONPAG \(|FPINTROTINA \(|REFERENCES (?!SGH_)/);
    // 0538: o CHECK do tipo do processamento troca por um que aceita `rescisao` (nada mais muda no processamento).
    expect(doM53[8]!.comandos.slice(0, 2)).toEqual([
      'ALTER TABLE SGH_PES_FOLHA_PROCESSO DROP CONSTRAINT SGH_CK_PES_FOLHA_PROC_TIPO',
      "ALTER TABLE SGH_PES_FOLHA_PROCESSO ADD CONSTRAINT SGH_CK_PES_FOLHA_PROC_TIPO2 CHECK (TIPO IN ('mensal', 'ferias', 'decimo1', 'decimo2', 'rescisao'))",
    ]);
    expect(doM53[8]!.comandos.join('\n')).toContain(
      'GRANT SELECT, INSERT, UPDATE ON SGH_PES_RESCISAO TO ROLE SGH_APLICACAO',
    );
    // 0536: colunas novas (a do tipo com padrão `mensal` para o que já existe), a chave do número com o tipo; sem DELETE.
    expect(doM53[6]!.comandos.slice(0, 4)).toEqual([
      "ALTER TABLE SGH_PES_FOLHA_PROCESSO ADD TIPO VARCHAR(8) DEFAULT 'mensal' NOT NULL",
      'ALTER TABLE SGH_PES_FOLHA_PROCESSO ADD PAGAMENTO DATE',
      'ALTER TABLE SGH_PES_FOLHA_PROCESSO DROP CONSTRAINT SGH_UQ_PES_FOLHA_PROC_NUM',
      'ALTER TABLE SGH_PES_FOLHA_PROCESSO ADD CONSTRAINT SGH_UQ_PES_FOLHA_PROC_NUM2 UNIQUE (HOSPITAL, COD_EMP, COMPETENCIA, TIPO, NUMERO)',
    ]);
    expect(doM53[2]!.comandos).toEqual([
      'ALTER TABLE SGH_PES_FOLHA_INTERFACE DROP CONSTRAINT SGH_CK_PES_FOLHA_INTF_COMP',
      expect.stringMatching(
        /^ALTER TABLE SGH_PES_FOLHA_INTERFACE ADD CONSTRAINT SGH_CK_PES_FOLHA_INTF_COMP2 CHECK/,
      ),
    ]);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M54 (etapa 5): apuração do custo do mês e custo por conta, só tabelas SGH_CUS_ novas; nenhuma CT* do outro sistema, nenhum DELETE', () => {
    const doM54 = scripts.filter((x) => x.numero === 576);
    expect(doM54.map((x) => x.arquivo)).toEqual(['custos/sgh/0576_cus_apuracao.sql']);
    const todos = doM54.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CUS_APURACAO',
      'SGH_CUS_APURACAO_CENTRO',
      'SGH_CUS_CUSTO_CONTA',
    ]);
    expect(todos).not.toMatch(/\b(DELETE|DROP)\b/);
    expect(todos).not.toMatch(/\b(CT[A-Z]+|TBCENCUS|FCCTAEXT)\b(?!\.)/);
  });

  it('M54 (etapa 5, correção): uma só apuração vigente por competência, índice único por expressão; nenhum DELETE', () => {
    const s = scripts.filter((x) => x.numero === 577);
    expect(s.map((x) => x.arquivo)).toEqual(['custos/sgh/0577_cus_apuracao_vigente_unica.sql']);
    expect(s[0]!.comandos).toEqual([
      "CREATE UNIQUE INDEX SGH_IDX_CUS_APUR_VIGENTE ON SGH_CUS_APURACAO COMPUTED BY (CASE WHEN SITUACAO <> 'substituida' THEN HOSPITAL || '|' || COMPETENCIA END)",
    ]);
  });

  it('M54 (etapa 4): estrutura de custos e estatísticas, só tabelas SGH_CUS_ novas; nenhuma CT* do outro sistema, nenhum DELETE', () => {
    const doM54 = scripts.filter((x) => x.numero === 546);
    expect(doM54.map((x) => x.arquivo)).toEqual(['custos/sgh/0546_cus_estrutura.sql']);
    const todos = doM54.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CUS_CENTRO',
      'SGH_CUS_ESTATISTICA',
      'SGH_CUS_COLETA',
    ]);
    expect(todos).not.toMatch(/\b(DELETE|DROP)\b/);
    expect(todos).not.toMatch(/\b(CTCENSO|CTTIPODADO|TBCENCUS|TBUNIMEN)\b\s*\(/);
    expect(todos).toMatch(/GRANT SELECT, INSERT ON SGH_CUS_COLETA TO ROLE SGH_APLICACAO/);
  });

  it('M54 (etapa 6): patrimônio só em tabelas SGH_PAT_ novas; a cota da depreciação e a leitura do inventário imutáveis; nenhuma GP* do outro sistema, nenhum DELETE', () => {
    const doM54 = scripts.filter((x) => x.numero === 548);
    expect(doM54.map((x) => x.arquivo)).toEqual(['patrimonio/sgh/0548_pat_patrimonio.sql']);
    const todos = doM54.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PAT_BEM',
      'SGH_PAT_MOVIMENTO',
      'SGH_PAT_CALCULO',
      'SGH_PAT_DEPRECIACAO',
      'SGH_PAT_INVENTARIO',
      'SGH_PAT_INV_LEITURA',
    ]);
    expect(todos).not.toMatch(/\b(DELETE|DROP)\b/);
    expect(todos).not.toMatch(/\b(GPBENS|GPDEPREC|GPTRANSF|GPBAIXA|GECADNFS|GELANNFS)\b\s*\(/);
    expect(todos).toMatch(/GRANT SELECT, INSERT ON SGH_PAT_DEPRECIACAO TO ROLE SGH_APLICACAO/);
    expect(todos).toMatch(/GRANT SELECT, INSERT ON SGH_PAT_INV_LEITURA TO ROLE SGH_APLICACAO/);
    expect(todos).toMatch(/GRANT SELECT, INSERT ON SGH_PAT_CALCULO TO ROLE SGH_APLICACAO/);
  });

  it('M54 (etapa 6, correção da revisão): o 0977 com a linha-guarda do item da nota (o cadastro concorrente do mesmo item se espera); nada do outro sistema', () => {
    const c977 = scripts.find((x) => x.numero === 977)!;
    expect(c977.arquivo).toBe('patrimonio/sgh/0977_pat_item_trava.sql');
    const t = c977.comandos.join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual(['SGH_PAT_ITEM_TRAVA']);
    expect(t).toContain('PRIMARY KEY (HOSPITAL, ID_GELANNFS)');
    expect(t).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PAT_ITEM_TRAVA TO ROLE SGH_APLICACAO');
    expect(t).not.toMatch(/\b(DELETE|DROP|REFERENCES)\b/);
  });

  it('M54 (etapa 1): plano de contas, regra versionada (só SELECT e INSERT), fontes e fatos (UPDATE só da situação); nada com DELETE nem DROP', () => {
    const doM54 = scripts.filter((x) => x.numero >= 540 && x.numero <= 542);
    expect(doM54.map((x) => x.arquivo)).toEqual([
      'contabil/sgh/0540_ctb_plano_conta.sql',
      'contabil/sgh/0541_ctb_regra.sql',
      'contabil/sgh/0542_ctb_fato.sql',
    ]);
    const todos = doM54.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CTB_PLANO_CONTA',
      'SGH_CTB_REGRA',
      'SGH_CTB_FONTE',
      'SGH_CTB_FATO',
    ]);
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b/);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CTB_REGRA TO ROLE SGH_APLICACAO');
    expect(todos).toContain(
      'GRANT UPDATE (SITUACAO, MOTIVO, REGRA_ID) ON SGH_CTB_FATO TO ROLE SGH_APLICACAO',
    );
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_CTB_FATO UNIQUE (HOSPITAL, TABELA, CHAVE_ORIGEM, TIPO, IMPRESSAO, ESTORNO)',
    );
  });

  it('M54 (etapa 2): lançamentos e partidas imutáveis (só SELECT e INSERT), período e conciliação; nada com DELETE nem DROP', () => {
    const doM54 = scripts.filter((x) => x.numero >= 543 && x.numero <= 544);
    expect(doM54.map((x) => x.arquivo)).toEqual([
      'contabil/sgh/0543_ctb_lancamento.sql',
      'contabil/sgh/0544_ctb_periodo.sql',
    ]);
    const todos = doM54.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CTB_LANCAMENTO',
      'SGH_CTB_PARTIDA',
      'SGH_CTB_PERIODO',
      'SGH_CTB_CONCILIACAO',
      'SGH_CTB_CONCILIACAO_PARTIDA',
    ]);
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b|REFERENCES (?!SGH_)/);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CTB_LANCAMENTO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CTB_PARTIDA TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/GRANT [A-Z, ]*UPDATE[A-Z, ]* ON SGH_CTB_(LANCAMENTO|PARTIDA) /);
    expect(todos).toContain('CONSTRAINT SGH_UQ_CTB_LANC_ESTORNO UNIQUE (HOSPITAL, ESTORNA_ID)');
    expect(todos).toContain('CHECK (DEBITOS = CREDITOS AND DEBITOS > 0)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_CTB_CONC_PART_ATIVA UNIQUE (HOSPITAL, PARTIDA_ATIVA)');
  });

  it('M54 (etapa 7): orçamento empresarial, só tabelas SGH_ORC_ novas; nenhuma tabela do outro sistema', () => {
    const c = scripts.filter((x) => x.numero === 549);
    expect(c.map((x) => x.arquivo)).toEqual(['financeiro/sgh/0549_orc_orcamento.sql']);
    const todos = c.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_ORC_ORCAMENTO',
      'SGH_ORC_LINHA',
    ]);
    expect([...todos.matchAll(/REFERENCES ([A-Z_]+)/g)].map((m) => m[1])).toEqual(['SGH_ORC_ORCAMENTO']);
    expect(todos).not.toMatch(/\b(ALTER|DROP)\b/);
    expect(todos).toMatch(/UNIQUE \(VIGENTE_CHAVE\)/);
  });

  it('M54 (etapa 2, correção): a situação do fato cabe "contabilizado" (13); só a expansão da coluna', () => {
    const c = scripts.filter((x) => x.numero === 545);
    expect(c.map((x) => x.arquivo)).toEqual(['contabil/sgh/0545_ctb_fato_situacao.sql']);
    expect(c.flatMap((x) => x.comandos)).toEqual([
      'ALTER TABLE SGH_CTB_FATO ALTER COLUMN SITUACAO TYPE VARCHAR(16)',
    ]);
  });

  it('M54 (etapa 3): o tipo apuracao no lançamento (troca da CHECK) e o arquivo do SPED (cifrado, sem DELETE)', () => {
    const c = scripts.filter((x) => x.numero === 976);
    expect(c.map((x) => x.arquivo)).toEqual(['contabil/sgh/0976_ctb_arquivo_sped.sql']);
    const todos = c.flatMap((x) => x.comandos).join('\n');
    expect(c[0]!.comandos.slice(0, 2)).toEqual([
      'ALTER TABLE SGH_CTB_LANCAMENTO DROP CONSTRAINT SGH_CK_CTB_LANC_TIPO',
      "ALTER TABLE SGH_CTB_LANCAMENTO ADD CONSTRAINT SGH_CK_CTB_LANC_TIPO2 CHECK (TIPO IN ('automatico', 'manual', 'estorno', 'apuracao'))",
    ]);
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CTB_ARQUIVO_SPED',
    ]);
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP TABLE\b|REFERENCES (?!SGH_)/);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CTB_ARQUIVO_SPED TO ROLE SGH_APLICACAO');
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_CTB_SPED_NUMERO UNIQUE (HOSPITAL, EMPRESA, TIPO, EXERCICIO, NUMERO)',
    );
  });

  it('M54 (etapa 2, correção): as UNIQUE do estorno e da partida ativa passam a uma coluna (NULL não colide)', () => {
    const c = scripts.filter((x) => x.numero === 547);
    expect(c.map((x) => x.arquivo)).toEqual(['contabil/sgh/0547_ctb_unicas_simples.sql']);
    expect(c.flatMap((x) => x.comandos)).toEqual([
      'ALTER TABLE SGH_CTB_LANCAMENTO DROP CONSTRAINT SGH_UQ_CTB_LANC_ESTORNO',
      'ALTER TABLE SGH_CTB_LANCAMENTO ADD CONSTRAINT SGH_UQ_CTB_LANC_ESTORNO2 UNIQUE (ESTORNA_ID)',
      'ALTER TABLE SGH_CTB_CONCILIACAO_PARTIDA DROP CONSTRAINT SGH_UQ_CTB_CONC_PART_ATIVA',
      'ALTER TABLE SGH_CTB_CONCILIACAO_PARTIDA ADD CONSTRAINT SGH_UQ_CTB_CONC_PART_ATIVA2 UNIQUE (PARTIDA_ATIVA)',
    ]);
  });

  it('M58 (etapa 1): só a checklist do inventário do desligamento, uma linha por item; nada com DELETE nem DROP', () => {
    const doM58 = scripts.filter((x) => x.numero >= 580 && x.numero <= 589);
    expect(doM58.map((x) => x.arquivo)).toEqual(['config/sgh/0580_coex_desligamento.sql']);
    const todos = doM58.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CFG_COEX_DESLIG',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_PK_CFG_COEX_DESLIG PRIMARY KEY (HOSPITAL, ITEM)');
    // Regra 2: só se registra substituto em uso ou aceite (pendente é a ausência da linha), com papel e evidência.
    expect(todos).toContain("CHECK (SITUACAO IN ('substituto-em-uso', 'aceito-como-perdido'))");
    expect(todos).toMatch(/CHAR_LENGTH\(EVIDENCIA\) >= 3 AND CHAR_LENGTH\(PAPEL\) >= 2/);
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b/);
  });

  it('M59 (etapa 2): credencial forte e política do segundo fator; nada com DELETE nem DROP; sem FK para o legado', () => {
    const doM59 = scripts.filter((x) => x.numero >= 590 && x.numero <= 591);
    expect(doM59.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/0590_acesso_credencial.sql',
      'acesso/sgh/0591_acesso_politica_2fa.sql',
    ]);
    const todos = doM59.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_0-9]+)/g)].map((m) => m[1])).toEqual([
      'SGH_ACESSO_CREDENCIAL',
      'SGH_ACESSO_POLITICA_2FA',
    ]);
    // Regra 2: a credencial substituída perde o hash (a viva sempre tem).
    expect(todos).toContain('CHECK (SUBSTITUIDA_EM IS NOT NULL OR HASH_PHC IS NOT NULL)');
    expect(todos).toContain("CHECK (ALVO IN ('perfil', 'grupo', 'todos'))");
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b|REFERENCES/);
  });

  it('M59 (etapa 4): plano do saneamento dos grupos; nada com DELETE nem DROP; sem FK para o legado', () => {
    const doM59 = scripts.filter((x) => x.numero === 593);
    expect(doM59.map((x) => x.arquivo)).toEqual(['acesso/sgh/0593_acesso_saneamento.sql']);
    const todos = doM59.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_0-9]+)/g)].map((m) => m[1])).toEqual([
      'SGH_ACESSO_SANEAMENTO',
    ]);
    // Regra 8: quem aprova é outra pessoa (nem quem propôs nem o próprio usuário); ninguém decide sobre si.
    expect(todos).toContain('APROVADO_POR <> CRIADO_POR');
    expect(todos).toContain('CRIADO_POR <> LOGIN');
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b|REFERENCES/);
  });

  it('M59 (etapa 5): termo das concessões, ciclos SBIS e restauração; nada com DELETE nem DROP; sem FK para o legado', () => {
    const doM59 = scripts.filter((x) => x.numero >= 594 && x.numero <= 596);
    expect(doM59.map((x) => x.arquivo)).toEqual([
      'auditoria/sgh/0594_audit_concessao.sql',
      'auditoria/sgh/0595_audit_sbis_ciclo.sql',
      'auditoria/sgh/0596_audit_restauracao.sql',
    ]);
    const todos = doM59.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_0-9]+)/g)].map((m) => m[1])).toEqual([
      'SGH_AUDIT_CONCESSAO',
      'SGH_AUDIT_SBIS_CICLO',
      'SGH_AUDIT_SBIS_ITEM',
      'SGH_AUDIT_RESTAURACAO',
    ]);
    // Regra 9: certificado só na auditoria apta; a correção é verificada por outra pessoa; restauração só inclusão.
    expect(todos).toContain("CERTIFICADO IS NULL OR (TIPO = 'auditoria' AND PARECER = 'apto')");
    expect(todos).toContain('VERIFICADO_POR <> CORRIGIDO_POR');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_AUDIT_RESTAURACAO TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b/);
    expect([...todos.matchAll(/REFERENCES (\w+)/g)].map((m) => m[1])).toEqual(['SGH_AUDIT_SBIS_CICLO']);
  });

  it('W0-02: os scripts do motor do CRUD genérico ficam na faixa 1170 a 1179, só inclusão, sem FK nem gatilho no legado', () => {
    const doW002 = scripts.filter((x) => x.numero >= 1170 && x.numero <= 1179);
    expect(doW002.map((x) => x.arquivo)).toEqual([
      'config/sgh/1170_crud_evento.sql',
      'config/sgh/1171_crud_vigia.sql',
    ]);
    const todos = doW002.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_0-9]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CRUD_EVENTO',
      'SGH_CRUD_VIGIA_RETRATO',
      'SGH_CRUD_VIGIA_ACHADO',
    ]);
    // A trilha nunca é alterada; a vigia só lê o legado (D-CRUD-SEM-GATILHO): nada de UPDATE, DELETE, FK ou gatilho.
    expect(todos).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|REFERENCES|TRIGGER/);
    for (const t of ['SGH_CRUD_EVENTO', 'SGH_CRUD_VIGIA_RETRATO', 'SGH_CRUD_VIGIA_ACHADO'])
      expect(todos).toContain(`GRANT SELECT, INSERT ON ${t} TO ROLE SGH_APLICACAO`);
  });

  it('W1-01: os scripts do acesso (senha provisória, descrição do grupo, política de senha, limite de sessões, exceções das contas dormentes, recertificação, pedido de acesso, provisionamento pelo RH, PIN da troca rápida, conferência do conselho) ficam na faixa 1200 a 1219, sem tocar o legado', () => {
    const doW101 = scripts.filter((x) => x.numero >= 1200 && x.numero <= 1219);
    expect(doW101.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/1200_acesso_senha_provisoria.sql',
      'acesso/sgh/1201_acesso_grupo_descricao.sql',
      'acesso/sgh/1202_acesso_politica_senha.sql',
      'acesso/sgh/1203_acesso_limite_sessao.sql',
      'acesso/sgh/1204_acesso_dormencia_excecao.sql',
      'acesso/sgh/1205_acesso_grupo_descr_versao_unica.sql',
      'acesso/sgh/1206_acesso_recertificacao.sql',
      'acesso/sgh/1207_acesso_pedido.sql',
      'acesso/sgh/1208_acesso_provisionamento_rh.sql',
      'acesso/sgh/1209_acesso_pin.sql',
      'acesso/sgh/1210_acesso_pin_vivo_unico.sql',
      'acesso/sgh/1211_acesso_conselho_conferencia.sql',
    ]);
    const todos = doW101.flatMap((x) => x.comandos).join('\n');
    expect(todos).toContain("ORIGEM IN ('primeiro-login', 'troca-senha', 'senha-provisoria')");
    expect([...todos.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1])).toEqual([
      'SGH_ACESSO_CREDENCIAL',
      'SGH_ACESSO_CREDENCIAL',
      'SGH_ACESSO_GRUPO_DESCR',
    ]);
    // Revisão: nunca duas "versão N" da descrição no mesmo nome de grupo.
    expect(todos).toContain('UNIQUE (GRUPO, VERSAO)');
    expect([...todos.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1])).toEqual([
      'SGH_ACESSO_GRUPO_DESCR',
      'SGH_ACESSO_POLITICA_SENHA',
      'SGH_ACESSO_LIMITE_SESSAO',
      'SGH_ACESSO_DORMENCIA_EXCECAO',
      'SGH_ACESSO_RECERT_CAMPANHA',
      'SGH_ACESSO_RECERT_ITEM',
      'SGH_ACESSO_PEDIDO',
      'SGH_ACESSO_RH_PERFIL_CARGO',
      'SGH_ACESSO_RH_TAREFA',
      'SGH_ACESSO_PIN',
      'SGH_ACESSO_CONSELHO_CONFER',
    ]);
    // Conferência do conselho (parte 11d): só inclusão; situação e fonte fechadas pelo banco.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_CONSELHO_CONFER TO ROLE SGH_APLICACAO');
    expect(todos).toContain(
      "CHECK (SITUACAO IN ('ativo', 'inativo', 'suspenso', 'cancelado', 'nao-localizado'))",
    );
    // PIN da troca rápida: só o hash, encerrado sem ele.
    expect(todos).toContain("OR (SITUACAO IN ('substituido', 'retirado') AND HASH_PHC IS NULL");
    // Revisão (achado 5): uma linha viva por login garantida pelo banco.
    expect(todos).toContain(
      "CREATE UNIQUE INDEX SGH_UQ_ACESSO_PIN_VIVO ON SGH_ACESSO_PIN COMPUTED BY (CASE WHEN SITUACAO = 'vivo' THEN LOGIN END)",
    );
    // Provisionamento pelo RH: mapa cargo -> perfil e resolução das tarefas só por inclusão; uma resolução por tarefa.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_RH_PERFIL_CARGO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_RH_TAREFA TO ROLE SGH_APLICACAO');
    expect(todos).toContain('UNIQUE (HOSPITAL, TIPO, ID_VINCULO, REF)');
    // Pedido de acesso: dois níveis de pessoas diferentes, nenhum o próprio solicitante.
    expect(todos).toContain('CHECK (ACESSOS_POR IS NULL OR ACESSOS_POR <> SETOR_POR)');
    // Recertificação: a decisão passa de pendente a decidida uma vez só e ninguém decide a própria conta.
    expect(todos).toContain('CHECK (DECIDIDO_POR IS NULL OR DECIDIDO_POR <> LOGIN)');
    // O limite de sessões é fato novo: só inclusão (nada se edita nem se apaga).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_LIMITE_SESSAO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_DORMENCIA_EXCECAO TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bTB[A-Z]|REFERENCES|TRIGGER|\bDELETE\b/);
  });

  it('W0-04: os scripts da qualidade e CCIH (correção e cancelamento) ficam na faixa 1020 a 1039', () => {
    expect(scripts.filter((x) => x.numero >= 1020 && x.numero <= 1039).map((x) => x.arquivo)).toEqual([
      'qualidade/sgh/1020_qua_crud_correcao.sql',
      'qualidade/sgh/1021_qua_ouvidoria_canais.sql',
      'qualidade/sgh/1022_qua_ouvidoria_pesquisa_unica.sql',
      'qualidade/sgh/1023_qua_dispositivo_bundle.sql',
      'qualidade/sgh/1024_qua_notificacao_flebite.sql',
      'qualidade/sgh/1025_qua_revisao_prontuario.sql',
      'qualidade/sgh/1026_qua_revisao_correcoes.sql',
    ]);
  });

  it('W0-05: os scripts de nutrição, serviço social, oncologia e lactário ficam na faixa 1040 a 1059', () => {
    expect(scripts.filter((x) => x.numero >= 1040 && x.numero <= 1059).map((x) => x.numero)).toEqual([
      1040, 1041, 1042,
    ]);
  });

  it('W0-10: os scripts dos portais e auditores ficam na faixa 1140 a 1159, só SGH_ e sem DELETE', () => {
    const doW010 = scripts.filter((x) => x.numero >= 1140 && x.numero <= 1159);
    expect(doW010.map((x) => x.arquivo)).toEqual([
      'cadastro/sgh/1140_portal_troca_email.sql',
      'auditoria/sgh/1141_pedido_titular_cancelamento.sql',
      'auditoria/sgh/1142_pedido_titular_cancelamento_motivo.sql',
      'faturamento/sgh/1143_portal_conciliacao.sql',
      'auditoria/sgh/1144_copia_prontuario.sql',
      'sadt/sgh/1145_portal_medico_conta.sql',
      'sadt/sgh/1146_portal_medico_troca_email.sql',
      'cirurgia/sgh/1147_portal_medico_pedido_versao.sql',
      'sadt/sgh/1148_portal_medico_critico_aviso.sql',
      'operadora/sgh/1149_ope_protocolo_resposta.sql',
      'operadora/sgh/1150_ope_autorizacao_anexo.sql',
      'operadora/sgh/1151_ope_autorizacao_responsavel.sql',
      'operadora/sgh/1152_ope_auditor_hist.sql',
      'operadora/sgh/1153_ope_elegibilidade_consulta.sql',
      'operadora/sgh/1154_ope_conta_recurso_item.sql',
    ]);
    const todos = doW010.flatMap((x) => x.comandos).join('\n');
    expect(todos).not.toMatch(/\bDELETE\b|DROP\s+(TABLE|INDEX)|TRIGGER/);
    expect([...todos.matchAll(/(?:CREATE|ALTER) TABLE (\w+)/g)].every((m) => m[1]!.startsWith('SGH_'))).toBe(
      true,
    );
  });

  it('W0-08: os scripts da manutenção e do patrimônio ficam na faixa 1100 a 1119; a versão do plano é só de inclusão', () => {
    const doW008 = scripts.filter((x) => x.numero >= 1100 && x.numero <= 1119);
    expect(doW008.map((x) => x.arquivo)).toEqual([
      'manutencao/sgh/1100_man_preventiva_versao.sql',
      'manutencao/sgh/1101_man_cobertura_versao.sql',
      'patrimonio/sgh/1102_pat_grupo.sql',
      'patrimonio/sgh/1103_pat_calculo_estorno.sql',
      'patrimonio/sgh/1104_pat_inventario_cancelado.sql',
      'patrimonio/sgh/1105_pat_ajuste.sql',
      'manutencao/sgh/1106_man_alerta_tecnovig.sql',
      'manutencao/sgh/1107_man_ciclo_vida.sql',
      'manutencao/sgh/1108_man_preventiva_modelo.sql',
      'patrimonio/sgh/1109_pat_laudo.sql',
    ]);
    const todos = doW008.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_0-9]+)/g)].map((m) => m[1])).toEqual([
      'SGH_MAN_PREVENTIVA_VERSAO',
      'SGH_MAN_COBERTURA_VERSAO',
      'SGH_PAT_GRUPO',
      'SGH_PAT_GRUPO_VERSAO',
      'SGH_PAT_CALCULO_ESTORNO',
      'SGH_PAT_AJUSTE',
      'SGH_PAT_AJUSTE_ESTORNO',
      'SGH_MAN_ALERTA',
      'SGH_MAN_ALERTA_EQUIP',
      'SGH_MAN_OS_QUEIXA',
      'SGH_MAN_MODELO_CURSO',
      'SGH_MAN_EQUIP_EVENTO',
      'SGH_PAT_LAUDO',
    ]);
    // Só mexe em tabela SGH_ (nada do legado); DELETE só como permissão (a exclusão física do contrato sem vínculo).
    expect([...todos.matchAll(/ALTER TABLE (\w+)/g)].every((m) => m[1]?.startsWith('SGH_'))).toBe(true);
    // DROP só da UNIQUE do cálculo e da cota (recriadas com a RODADA, 1103: a competência estornada se recalcula) e do
    // CHECK da situação do inventário (recriado com o cancelado, 1104).
    const semDropDaRodada = todos.replace(
      /ALTER TABLE SGH_PAT_\w+ DROP CONSTRAINT SGH_(UQ_PAT_CALCULO|UQ_PAT_DEPREC_BEM|CK_PAT_INV_SIT)\b/g,
      '',
    );
    expect(semDropDaRodada.replace(/GRANT [^\n]*/g, '')).not.toMatch(
      /\bUPDATE\b|\bDELETE\b|\bDROP\b|TRIGGER/,
    );
    // O cálculo e a cota seguem imutáveis (o estorno é fato novo, só de inclusão).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PAT_CALCULO_ESTORNO TO ROLE SGH_APLICACAO');
    // Os ajustes do bem (M1, 1105): eventos só de inclusão, o estorno também.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PAT_AJUSTE TO ROLE SGH_APLICACAO');
    // M2 (1106): a OS de ação de campo do alerta e a queixa aberta da OS são só de inclusão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_ALERTA_EQUIP TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_OS_QUEIXA TO ROLE SGH_APLICACAO');
    // M4 (1108): o plano instalado de um modelo pronto guarda o código e a versão do modelo (o plano segue versionado).
    expect(todos).toContain('ALTER TABLE SGH_MAN_PREVENTIVA ADD MODELO VARCHAR(20)');
    // M3 (1107): os eventos do ciclo de vida são só de inclusão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_EQUIP_EVENTO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PAT_AJUSTE_ESTORNO TO ROLE SGH_APLICACAO');
    // Achado 6 (1109): o laudo anexado é imutável e o ajuste aponta para ele pela FK (não há laudo inexistente).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PAT_LAUDO TO ROLE SGH_APLICACAO');
    expect(todos).toContain(
      'ALTER TABLE SGH_PAT_AJUSTE ADD CONSTRAINT SGH_FK_PAT_AJUSTE_LAUDO FOREIGN KEY (ID_LAUDO) REFERENCES SGH_PAT_LAUDO (ID)',
    );
    expect(todos).not.toMatch(/GRANT [^\n]*(UPDATE|DELETE)[^\n]* ON SGH_PAT_LAUDO/);
    expect(todos).not.toMatch(/GRANT [^\n]*(UPDATE|DELETE)[^\n]* ON SGH_PAT_AJUSTE/);
    expect(todos).not.toMatch(/GRANT [^\n]*UPDATE[^\n]* ON SGH_PAT_(CALCULO|DEPRECIACAO) /);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_MAN_PREVENTIVA_VERSAO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT DELETE ON SGH_MAN_COBERTURA TO ROLE SGH_APLICACAO');
    // O grupo do bem: cadastro do Sante (inclusão, alteração, inativação; exclusão física do nunca usado).
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON SGH_PAT_GRUPO TO ROLE SGH_APLICACAO');
    // A FK só aponta para tabela do novo.
    expect([...todos.matchAll(/REFERENCES (\w+)/g)].every((m) => m[1]?.startsWith('SGH_'))).toBe(true);
  });

  it('M44: protocolo versionado (imutável), classificação só de inclusão com a sucessão única e o aviso de estouro único; nada com UPDATE nem DELETE', () => {
    const doM44 = scripts.filter((x) => x.numero >= 440 && x.numero <= 449);
    expect(doM44.map((x) => x.arquivo).slice(0, 3)).toEqual([
      'recepcao/sgh/0440_pa_protocolo.sql',
      'recepcao/sgh/0441_pa_classificacao.sql',
      'recepcao/sgh/0442_pa_sinal_atendimento.sql',
    ]);
    const todos = doM44
      .filter((x) => x.numero <= 442)
      .flatMap((x) => x.comandos)
      .join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PA_PROTOCOLO',
      'SGH_PA_PROTOCOLO_COR',
      'SGH_PA_DISCRIMINADOR',
      'SGH_PA_CLASSIFICACAO',
      'SGH_PA_CLASSIF_AVISO',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_PA_PROTOCOLO_VERSAO UNIQUE (HOSPITAL, PROTOCOLO, VERSAO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PA_CLASSIFICACAO_SUCEDE UNIQUE (HOSPITAL, SUCEDE)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PA_CLASSIF_AVISO UNIQUE (CHAVE)');
    // Os sinais recentes por atendimento (fila e tela) pelo índice próprio, não pelo prefixo HOSPITAL.
    expect(todos).toContain(
      'CREATE INDEX SGH_IDX_PEP_SINAL_ATEND ON SGH_PEP_SINAL_VITAL (HOSPITAL, ID_ATCABECATEND, HORA_REAL)',
    );
    expect(todos).toMatch(/TIPO <> 'manchester' OR \(LICENCA_REGISTRO IS NOT NULL/);
    // Só inclusão: nenhuma concessão de UPDATE ou DELETE às tabelas da classificação.
    expect(todos).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE)\b/);
  });

  it('M44 (etapa 2): o NIR com uma solicitação aberta por paciente, uma reserva vigente por leito, a alta prevista só de inclusão com a sucessão única; nada com DELETE', () => {
    const doNir = scripts.filter((x) => x.numero >= 443 && x.numero <= 448);
    expect(doNir.map((x) => x.arquivo)).toEqual([
      'internacao/sgh/0443_nir_solicitacao.sql',
      'internacao/sgh/0444_nir_reserva.sql',
      'internacao/sgh/0445_nir_alta_prevista.sql',
      'internacao/sgh/0446_nir_limite.sql',
      'internacao/sgh/0447_nir_depara.sql',
      'internacao/sgh/0448_nir_chaves_unicas.sql',
    ]);
    const todos = doNir.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_INT_SOLIC_LEITO',
      'SGH_INT_SOLIC_LEITO_EVT',
      'SGH_INT_RESERVA_LEITO',
      'SGH_INT_DPA',
      'SGH_INT_BARREIRA_ALTA',
      'SGH_INT_LIMITE_PERMAN',
      'SGH_INT_SITREG_DEPARA',
    ]);
    // A chave de uma coluna (0448): a composta com o estabelecimento tratava as nulas como iguais no Firebird.
    expect(todos).toContain('ADD CONSTRAINT SGH_UQ_INT_SOLIC_ATIVA UNIQUE (ATIVA)');
    expect(todos).toContain('ADD CONSTRAINT SGH_UQ_INT_RESERVA_VIG UNIQUE (VIGENTE)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_INT_DPA_SUCEDE UNIQUE (HOSPITAL, SUCEDE)');
    // A alta prevista e os eventos da solicitação são só de inclusão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_INT_DPA TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_INT_SOLIC_LEITO_EVT TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    // Nenhuma FK para tabela do legado (só entre as SGH_).
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M45 (etapa 6): especialidades sob demanda e o lactário (0945, fora da faixa) só de inclusão, salvo a validação do ciclo e a conferência da ordem, uma vez e por outra pessoa', () => {
    const [s945] = scripts.filter((x) => x.numero === 945);
    expect(s945?.arquivo).toBe('pep/sgh/0945_especialidades.sql');
    const a = (s945?.comandos ?? []).join('\n');
    expect([...a.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_OFT_EXAME',
      'SGH_PEP_OFT_EXAME_ITEM',
      'SGH_PEP_ONCO_PROTOCOLO',
      'SGH_PEP_ONCO_CICLO',
      'SGH_PEP_OBST_PARTOGRAMA',
      'SGH_PEP_OBST_RN',
      'SGH_HOT_LACTARIO_ORDEM',
    ]);
    // Regra 14 (por analogia): a versão do protocolo é imutável; o mesmo conteúdo não vira outra versão.
    expect(a).toContain('CONSTRAINT SGH_UQ_PEP_ONCO_PROT_HASH UNIQUE (HOSPITAL, CODIGO, CONTENT_HASH)');
    expect(a).toContain('GRANT SELECT, INSERT ON SGH_PEP_ONCO_PROTOCOLO TO ROLE SGH_APLICACAO');
    // Dois olhos no banco: quem valida o ciclo e quem confere a ordem não é quem registrou.
    expect(a).toContain('VALIDADO_POR <> POR');
    expect(a).toContain('CONFERIDO_POR <> POR');
    expect(a).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PEP_ONCO_CICLO TO ROLE SGH_APLICACAO');
    expect(a).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_HOT_LACTARIO_ORDEM TO ROLE SGH_APLICACAO');
    expect(a).not.toMatch(/\bDELETE\b/);
    for (const m of a.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M45 (etapa 6, correção 0946): o curso do tratamento na chave do ciclo e a ligação com a prescrição só de inclusão', () => {
    const [s946] = scripts.filter((x) => x.numero === 946);
    expect(s946?.arquivo).toBe('pep/sgh/0946_pep_onco_curso_presc.sql');
    const a = (s946?.comandos ?? []).join('\n');
    expect([...a.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_ONCO_CICLO_PRESC',
    ]);
    expect(a).toContain('ALTER TABLE SGH_PEP_ONCO_CICLO ADD CURSO SMALLINT DEFAULT 1 NOT NULL');
    expect(a).toContain('ALTER TABLE SGH_PEP_ONCO_CICLO DROP CONSTRAINT SGH_UQ_PEP_ONCO_CICLO');
    expect(a).toContain('UNIQUE (HOSPITAL, ID_RICADPAC, CODIGO_PROTOCOLO, CURSO, NUMERO)');
    expect(a).toContain('CONSTRAINT SGH_PK_PEP_ONCO_CICLO_PRESC PRIMARY KEY (ID_CICLO, ID_PRPRESC)');
    expect(a).toContain('GRANT SELECT, INSERT ON SGH_PEP_ONCO_CICLO_PRESC TO ROLE SGH_APLICACAO');
    expect(a).not.toMatch(/\bDELETE\b|\bUPDATE\b/);
    for (const m of a.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M45 (etapa 1): formulário novo versionado (o rascunho alterado no lugar; publicado com o hash, aprovado por outra pessoa), casos substituídos, história e respostas só de inclusão', () => {
    const [s450] = scripts.filter((x) => x.numero === 450);
    expect(s450?.arquivo).toBe('pep/sgh/0450_pep_formnovo.sql');
    const todos = (s450?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_FORMNOVO',
      'SGH_PEP_FORMNOVO_CASO',
      'SGH_PEP_FORMNOVO_EVT',
      'SGH_PEP_FORMNOVO_RESP',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_FORMNOVO_VERSAO UNIQUE (HOSPITAL, CODIGO, VERSAO)');
    // Regra 14: publicado só com o hash e a aprovação de outra pessoa (quatro olhos também no banco).
    expect(todos).toContain('UPPER(APROVADO_POR) <> UPPER(AUTOR)');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PEP_FORMNOVO TO');
    expect(todos).toContain('GRANT SELECT, INSERT, DELETE ON SGH_PEP_FORMNOVO_CASO TO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_FORMNOVO_EVT TO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_FORMNOVO_RESP TO');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
    // D-APROV-45 (0451): quem escreveu também não publica; só a restrição nova, sem tabela.
    const [s451] = scripts.filter((x) => x.numero === 451);
    expect(s451?.arquivo).toBe('pep/sgh/0451_pep_formnovo_publicador.sql');
    expect((s451?.comandos ?? []).join('\n')).toContain(
      'ADD CONSTRAINT SGH_CK_PEP_FORMNOVO_PUBLICADOR CHECK (PUBLICADO_POR IS NULL OR UPPER(PUBLICADO_POR) <> UPPER(AUTOR))',
    );
    expect((s451?.comandos ?? []).join('\n')).not.toMatch(/CREATE TABLE|DROP|DELETE/);
  });

  it('M45 (etapa 3): balanço hídrico só de inclusão; chaves de "uma vez só" de uma coluna; o saldo conferido no banco', () => {
    const [s455] = scripts.filter((x) => x.numero === 455);
    expect(s455?.arquivo).toBe('enfermagem/sgh/0455_balanco.sql');
    const todos = (s455?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_BALANCO',
      'SGH_PEP_BALANCO_FECH',
    ]);
    // Regra 6: o ganho da checagem e a diurese dos sinais uma vez só; o estorno uma vez só; a chave do ato.
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_BALANCO_ORIGEM UNIQUE (CHAVE_ORIGEM)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_BALANCO_ESTORNO UNIQUE (CHAVE_ESTORNO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_BALANCO_CHAVE UNIQUE (IDEMPOTENCY_KEY)');
    expect(todos).toContain("CHAVE_ORIGEM = HOSPITAL || ':c:' || ID_PRCHKGERAL");
    expect(todos).toContain('CHECK (SALDO_ML = GANHOS_ML - PERDAS_ML - INSENSIVEIS_ML)');
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_PEP_BALANCO_FECH UNIQUE (HOSPITAL, ID_ATCABECATEND, ID_PRBHTIPOFECHAMENTO, INICIO, FIM)',
    );
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_BALANCO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_BALANCO_FECH TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|\bUPDATE\b|REFERENCES/);
  });

  it('M45 (etapa 3, correção): só a tabela de trava do atendimento e da janela do balanço; nada com DELETE nem DROP', () => {
    const [s456] = scripts.filter((x) => x.numero === 456);
    expect(s456?.arquivo).toBe('enfermagem/sgh/0456_balanco_trava.sql');
    const todos = (s456?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_BALANCO_TRAVA',
    ]);
    expect(todos).toContain(
      'CONSTRAINT SGH_PK_PEP_BALANCO_TRAVA PRIMARY KEY (HOSPITAL, ID_ATCABECATEND, INICIO)',
    );
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PEP_BALANCO_TRAVA TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b|REFERENCES/);
  });

  it('M46 (etapa 1): APA (0460) e SRPA (0462) só de inclusão; a ficha anestésica (0461) sem PRFA_*, com a versão, a assinatura e o balanço uma vez só', () => {
    const por = (n: number) => scripts.filter((x) => x.numero === n)[0];
    expect(por(460)?.arquivo).toBe('cirurgia/sgh/0460_apa.sql');
    expect(por(461)?.arquivo).toBe('cirurgia/sgh/0461_ficha_anestesica.sql');
    expect(por(462)?.arquivo).toBe('cirurgia/sgh/0462_srpa.sql');
    expect(por(463)?.arquivo).toBe('cirurgia/sgh/0463_ficha_partes.sql');
    const partes = (por(463)?.comandos ?? []).join('\n');
    expect([...partes.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CC_FA_PROCED',
      'SGH_CC_FA_EXAME',
      'SGH_CC_FA_ITEM_AVULSO',
      'SGH_CC_FA_BI',
    ]);
    expect([...partes.matchAll(/REFERENCES (\w+)/g)].every((m) => m[1] === 'SGH_CC_FA')).toBe(true);
    expect(partes).not.toMatch(/\bPRFA_|\bDELETE\b|\bDROP\b/);
    const apa = (por(460)?.comandos ?? []).join('\n');
    const ficha = (por(461)?.comandos ?? []).join('\n');
    const srpa = (por(462)?.comandos ?? []).join('\n');
    expect([...ficha.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CC_FA',
      'SGH_CC_FA_MONITORIZ',
      'SGH_CC_FA_MEDICAMENTO',
      'SGH_CC_FA_CAD_GAS',
      'SGH_CC_FA_GANHO',
      'SGH_CC_FA_PERDA',
      'SGH_CC_FA_INCIDENTE',
      'SGH_CC_FA_MODO_RESPIR',
      'SGH_CC_FA_POSICAO_CIR',
      'SGH_CC_FA_EQUIPE_CIR',
      'SGH_CC_FA_PASSAGEM',
      'SGH_CC_FA_LACUNA',
      'SGH_CC_FA_ADENDO',
    ]);
    // Regra 12: nenhuma referência às PRFA_* nem FK para o legado (as FKs só para SGH_CC_FA).
    for (const t of [apa, ficha, srpa]) expect(t).not.toMatch(/\bPRFA_|\bDELETE\b|\bDROP\b/);
    expect([...ficha.matchAll(/REFERENCES (\w+)/g)].every((m) => m[1] === 'SGH_CC_FA')).toBe(true);
    expect(apa + srpa).not.toMatch(/REFERENCES|\bUPDATE\b/);
    // Regra 3: a ficha assinada com o anestesista, a hora e o hash; o fluido vai ao balanço uma vez só.
    expect(ficha).toContain('CONSTRAINT SGH_UQ_CC_FA_GANHO_BALANCO UNIQUE (CHAVE_BALANCO)');
    expect(ficha).toContain("CHECK (CHAVE_BALANCO = 'cc-fa:' || ID_FICHA || ':' || ID)");
    expect(ficha).toContain("SITUACAO = 'assinada' AND ASSINADA_POR IS NOT NULL");
    // Regra 4: a admissão e a alta uma vez só; a alta com a versão da regra e o destino.
    expect(srpa).toContain('CONSTRAINT SGH_UQ_CC_SRPA_MOMENTO UNIQUE (CHAVE_MOMENTO)');
    expect(srpa).toContain('REGRA_VERSAO IS NOT NULL');
    expect(apa).toContain('GRANT SELECT, INSERT ON SGH_CC_APA TO ROLE SGH_APLICACAO');
    expect(srpa).toContain('GRANT SELECT, INSERT ON SGH_CC_SRPA TO ROLE SGH_APLICACAO');
    // Identificadores do Firebird com até 31 caracteres.
    for (const t of [apa, ficha, srpa, partes])
      for (const m of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(m[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M46 (etapa 2): checklist (0464) com os três momentos em ordem e o item só de inclusão; rastreio e código do painel (0465) sem PRFA_* nem FK para o legado', () => {
    const por = (n: number) => scripts.filter((x) => x.numero === n)[0];
    expect(por(464)?.arquivo).toBe('cirurgia/sgh/0464_checklist.sql');
    expect(por(465)?.arquivo).toBe('cirurgia/sgh/0465_rastreio_bloco.sql');
    const chk = (por(464)?.comandos ?? []).join('\n');
    const ras = (por(465)?.comandos ?? []).join('\n');
    expect([...chk.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CC_CHECKLIST',
      'SGH_CC_CHECKLIST_ITEM',
    ]);
    expect([...ras.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CC_MOVIMENTO',
      'SGH_CC_PAINEL_CODIGO',
    ]);
    // Regra 12: nenhuma PRFA_*; a única FK é do item para o checklist.
    for (const t of [chk, ras]) expect(t).not.toMatch(/\bPRFA_|\bDELETE\b|\bDROP\b/);
    expect([...chk.matchAll(/REFERENCES (\w+)/g)].map((m) => m[1])).toEqual(['SGH_CC_CHECKLIST']);
    expect(ras).not.toMatch(/REFERENCES/);
    // Regra 1: a pausa exige a entrada; a saída exige a pausa ou a exceção (regra 2), com o motivo.
    expect(chk).toContain('TIMEOUT_EM >= INDUCAO_EM');
    expect(chk).toContain('(TIMEOUT_EM IS NOT NULL OR EXCECAO_EM IS NOT NULL)');
    expect(chk).toContain('CHAR_LENGTH(TRIM(EXCECAO_MOTIVO)) >= 10');
    expect(chk).toContain('CONSTRAINT SGH_UQ_CC_CHECKLIST_AGENDA UNIQUE (HOSPITAL, ID_CCAGENDA)');
    expect(chk).toContain('GRANT SELECT, INSERT ON SGH_CC_CHECKLIST_ITEM TO ROLE SGH_APLICACAO');
    // O rastreio: a sequência única por agendamento, o código único no dia e válido por um dia.
    expect(ras).toContain('CONSTRAINT SGH_UQ_CC_MOVIMENTO_SEQ UNIQUE (HOSPITAL, ID_CCAGENDA, SEQ)');
    expect(ras).toContain('CONSTRAINT SGH_UQ_CC_PAINEL_COD_DIA UNIQUE (HOSPITAL, DIA, CODIGO)');
    expect(ras).toContain('VALIDO_ATE <= CAST(DIA AS TIMESTAMP) + 1');
    expect(ras).toContain('GRANT SELECT, INSERT ON SGH_CC_MOVIMENTO TO ROLE SGH_APLICACAO');
    expect(ras).not.toMatch(/\bUPDATE\b/);
    for (const t of [chk, ras])
      for (const m of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(m[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M46 (etapa 3): OPME (0466) com a solicitação, as etapas só de inclusão e o rastreio por lote ou série; sem GE*OPME nem FK para o legado', () => {
    const [s466] = scripts.filter((x) => x.numero === 466);
    expect(s466?.arquivo).toBe('suprimentos/sgh/0466_opme.sql');
    const t = (s466?.comandos ?? []).join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_SUP_OPME_SOLIC',
      'SGH_SUP_OPME_ETAPA',
      'SGH_SUP_OPME_RASTREIO',
    ]);
    // As FKs só entre as tabelas novas; nada das tabelas antigas de OPME (GE*OPME) nem do parâmetro.
    expect([...t.matchAll(/REFERENCES (\w+)/g)].map((m) => m[1])).toEqual([
      'SGH_SUP_OPME_SOLIC',
      'SGH_SUP_OPME_SOLIC',
    ]);
    expect(t).not.toMatch(/\bGE[A-Z]*OPME\b|\bGEPARAM\b|\bDELETE\b|\bDROP\b/);
    // Regra 6: a autorização com a senha e a guia; regra 8: o rastreio exige o lote ou a série; a exceção com o motivo.
    expect(t).toContain('(QTD_AUTORIZADA > 0 AND SENHA IS NOT NULL AND GUIA IS NOT NULL)');
    expect(t).toContain(
      "CHAR_LENGTH(TRIM(COALESCE(LOTE, ''))) > 0 OR CHAR_LENGTH(TRIM(COALESCE(SERIE, ''))) > 0",
    );
    expect(t).toContain(
      "ID_SOLIC IS NOT NULL OR (SEM_AUTORIZACAO_POR IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(SEM_AUTORIZACAO_MOTIVO, ''))) >= 10)",
    );
    expect(t).toContain('CONSTRAINT SGH_UQ_SUP_OPME_RAS_LANC UNIQUE (HOSPITAL, ID_GELANSAI)');
    expect(t).toContain('GRANT SELECT, INSERT ON SGH_SUP_OPME_ETAPA TO ROLE SGH_APLICACAO');
    for (const m of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(m[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M55 (etapa 5): contratualização SUS no 0555 (contrato com o gestor, metas e apurações); FKs só entre as novas; sem apagar nem tabela do legado; uma apuração por meta e período', () => {
    const s = scripts.find((x) => x.numero === 555);
    expect(s?.arquivo).toBe('faturamento/sgh/0555_sus_contratualizacao.sql');
    const t = (s?.comandos ?? []).join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUS_CONTRATO',
      'SGH_SUS_META',
      'SGH_SUS_META_APURACAO',
    ]);
    expect([...t.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUS_CONTRATO',
      'SGH_SUS_META',
    ]);
    expect(t).not.toMatch(/\bDELETE\b|\bDROP\b|\bALTER\b|COALESCE\([A-Z_]+, ''\)/);
    expect(t).not.toMatch(/\bON (?!SGH_)(?!SEQUENCE SGH_)[A-Z]/);
    for (const x of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(x[1]!.length).toBeLessThanOrEqual(31);
    for (const tab of ['SGH_SUS_CONTRATO', 'SGH_SUS_META', 'SGH_SUS_META_APURACAO'])
      expect(t).toContain(`GRANT SELECT, INSERT, UPDATE ON ${tab} TO ROLE SGH_APLICACAO`);
    expect(t).toContain('CONSTRAINT SGH_UQ_SUS_META_AP_PERIODO UNIQUE (ID_META, COMPETENCIA)');
    expect(t).toContain('CHECK (PERIODICIDADE NOT IN (4, 7, 8)');
  });

  it('M55 (etapa 3): contrato com fornecedor (0557), eventos só de inclusão (0558) e vínculo de pedido e título só de inclusão (0559); FKs só entre as novas; um contrato por pedido ou parcela; a exceção usada uma vez', () => {
    const [c, ev, vi] = [557, 558, 559].map((n) =>
      (scripts.find((x) => x.numero === n)?.comandos ?? []).join('\n'),
    );
    expect(scripts.filter((x) => [557, 558, 559].includes(x.numero)).map((x) => x.arquivo)).toEqual([
      'suprimentos/sgh/0557_sup_contrato.sql',
      'suprimentos/sgh/0558_sup_contrato_evento.sql',
      'suprimentos/sgh/0559_sup_contrato_vinculo.sql',
    ]);
    expect([...c!.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_CONTRATO']);
    expect([...ev!.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_CONTRATO']);
    expect([...vi!.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUP_CONTRATO',
      'SGH_SUP_CONTRATO_VINCULO',
      'SGH_SUP_CONTRATO_EVENTO',
    ]);
    for (const t of [c!, ev!, vi!]) {
      expect(t).not.toMatch(/\bDELETE\b|\bDROP\b|\bALTER\b|COALESCE\([A-Z_]+, ''\)/);
      expect(t).not.toMatch(/\bON (?!SGH_)(?!SEQUENCE SGH_)[A-Z]/);
      for (const x of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(x[1]!.length).toBeLessThanOrEqual(31);
    }
    expect(c).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_SUP_CONTRATO TO ROLE SGH_APLICACAO');
    expect(ev).toContain('GRANT SELECT, INSERT ON SGH_SUP_CONTRATO_EVENTO TO ROLE SGH_APLICACAO');
    expect(vi).toContain('GRANT SELECT, INSERT ON SGH_SUP_CONTRATO_VINCULO TO ROLE SGH_APLICACAO');
    expect(c).toContain('CHECK (UPPER(GESTOR) <> UPPER(FISCAL))');
    expect(vi).toContain('CONSTRAINT SGH_UQ_SUP_CONTR_VI_LEGADO UNIQUE (HOSPITAL, TIPO, ID_LEGADO)');
    expect(vi).toContain('CREATE UNIQUE INDEX SGH_UQ_SUP_CONTR_VI_EXCECAO_P');
  });

  it('M55 (etapa 4): o processo formal de compra (0554) com itens, preços e eventos só de inclusão, uma proposta por fornecedor e item, a homologação por outra pessoa no banco; FKs só entre as novas, nenhuma tabela GC*', () => {
    const s = scripts.find((x) => x.numero === 554);
    expect(s?.arquivo).toBe('suprimentos/sgh/0554_sup_licitacao.sql');
    const t = (s?.comandos ?? []).join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUP_LICITACAO',
      'SGH_SUP_LICITACAO_ITEM',
      'SGH_SUP_LICITACAO_PRECO',
      'SGH_SUP_LICITACAO_PROPOSTA',
      'SGH_SUP_LICITACAO_EVENTO',
    ]);
    expect([...t.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUP_LICITACAO',
      'SGH_SUP_LICITACAO_ITEM',
      'SGH_SUP_LICITACAO_ITEM',
      'SGH_SUP_LICITACAO',
    ]);
    expect(t).not.toMatch(/\bDROP\b|\bALTER\b|COALESCE\([A-Z_]+, ''\)|\bGC[A-Z]/);
    expect(t).not.toMatch(/\bON (?!SGH_)(?!SEQUENCE SGH_)[A-Z]/);
    for (const x of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(x[1]!.length).toBeLessThanOrEqual(31);
    expect(t).toContain('GRANT SELECT, INSERT ON SGH_SUP_LICITACAO_PRECO TO ROLE SGH_APLICACAO');
    expect(t).toContain('GRANT SELECT, INSERT ON SGH_SUP_LICITACAO_EVENTO TO ROLE SGH_APLICACAO');
    expect(t).toContain('CONSTRAINT SGH_UQ_SUP_LICIT_PROP UNIQUE (ID_ITEM, FORNECEDOR)');
    expect(t).toContain('UPPER(HOMOLOGADO_POR) <> UPPER(AGENTE)');
  });

  it('M55 (etapa 4, correção 0948): o descarte de preço da pesquisa só de inclusão, um por preço, com a justificativa; FK só para a tabela nova', () => {
    const s = scripts.find((x) => x.numero === 948);
    expect(s?.arquivo).toBe('suprimentos/sgh/0948_sup_licitacao_preco_descarte.sql');
    const t = (s?.comandos ?? []).join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual([
      'SGH_SUP_LICITACAO_PRECO_DESC',
    ]);
    expect([...t.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_LICITACAO_PRECO']);
    expect(t).not.toMatch(/\bDROP\b|\bALTER\b|\bUPDATE\b|\bGC[A-Z]/);
    expect(t).toContain('CONSTRAINT SGH_PK_SUP_LICIT_PRECO_DESC PRIMARY KEY (ID_PRECO)');
    expect(t).toContain('GRANT SELECT, INSERT ON SGH_SUP_LICITACAO_PRECO_DESC TO ROLE SGH_APLICACAO');
    for (const x of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(x[1]!.length).toBeLessThanOrEqual(31);
  });

  it('M46 (etapa 4): consignado (0467) só de inclusão, com o consumo reposto e faturado uma vez; manipulação (0468) com a dupla conferência no banco; sem tabela antiga nem FK para o legado', () => {
    const [s467] = scripts.filter((x) => x.numero === 467);
    const [s468] = scripts.filter((x) => x.numero === 468);
    expect(s467?.arquivo).toBe('suprimentos/sgh/0467_consignado.sql');
    expect(s468?.arquivo).toBe('suprimentos/sgh/0468_manipulacao.sql');
    const c = (s467?.comandos ?? []).join('\n');
    const m = (s468?.comandos ?? []).join('\n');
    expect([...c.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_CONSIGNADO']);
    expect([...m.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_MANIPULACAO']);
    // As FKs só para tabelas novas (o consumo em sala e a avaliação farmacêutica).
    expect([...c.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_OPME_RASTREIO']);
    expect([...m.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_AVALIACAO_FARM']);
    for (const t of [c, m]) {
      expect(t).not.toMatch(/\bGEPARAM\b|\bDELETE\b|\bDROP\b|\bALTER\b/);
      // Nenhum objeto criado nem concedido sobre tabela antiga.
      expect(t).not.toMatch(/\bON (?!SGH_)(?!SEQUENCE SGH_)[A-Z]/);
      for (const x of t.matchAll(/\b(SGH_[A-Z0-9_]+)/g)) expect(x[1]!.length).toBeLessThanOrEqual(31);
    }
    // Regra 10: o consignado só de inclusão; cada consumo reposto e faturado uma vez; a nota no faturamento.
    expect(c).toContain('GRANT SELECT, INSERT ON SGH_SUP_CONSIGNADO TO ROLE SGH_APLICACAO');
    expect(c).not.toMatch(/\bUPDATE\b/);
    expect(c).toContain('CONSTRAINT SGH_UQ_SUP_CONSIG_CONSUMO UNIQUE (HOSPITAL, TIPO, ID_OPME_RASTREIO)');
    expect(c).toContain(
      "CHECK (TIPO <> 'faturamento' OR (NF_ANO IS NOT NULL AND NF_MES IS NOT NULL AND NF_DOC IS NOT NULL))",
    );
    // Regra 11: a dupla conferência (duas pessoas) e a baixa ligada ao lançamento da saída.
    expect(m).toContain('CHECK (CONFERIDO_POR IS NULL OR CONFERIDO_POR <> PREPARADO_POR)');
    expect(m).toContain(
      "CHECK (SITUACAO <> 'baixada' OR (ID_GELANSAI IS NOT NULL AND SAIDA_DOC IS NOT NULL))",
    );
    expect(m).toContain('CONSTRAINT SGH_UQ_SUP_MANIP_LANC UNIQUE (HOSPITAL, ID_GELANSAI)');
  });

  it('M46 (etapa 4, revisão 0969, fora da faixa): a trava do saldo do consignado por fornecedor e item, só do novo e sem FK para o legado', () => {
    const [s969] = scripts.filter((x) => x.numero === 969);
    expect(s969?.arquivo).toBe('suprimentos/sgh/0969_consignado_trava.sql');
    const t = (s969?.comandos ?? []).join('\n');
    expect([...t.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((x) => x[1])).toEqual(['SGH_SUP_CONSIG_TRAVA']);
    expect(t).toContain('CONSTRAINT SGH_PK_SUP_CONSIG_TRAVA PRIMARY KEY (HOSPITAL, FORNECEDOR, ITEM)');
    expect(t).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_SUP_CONSIG_TRAVA TO ROLE SGH_APLICACAO');
    expect(t).not.toMatch(/\bREFERENCES\b|\bDELETE\b|\bDROP\b|\bALTER\b/);
    expect(t).not.toMatch(/\bON (?!SGH_)(?!SEQUENCE SGH_)[A-Z]/);
  });

  it('M46 (etapa 4, correção 0469): os CHECKs de texto obrigatório do OPME, do consignado e da manipulação sem o literal no COALESCE (o texto com acento numa coluna NONE)', () => {
    const [s469] = scripts.filter((x) => x.numero === 469);
    expect(s469?.arquivo).toBe('suprimentos/sgh/0469_checks_texto.sql');
    const t = (s469?.comandos ?? []).join('\n');
    expect(t).not.toMatch(/COALESCE\([A-Z_]+, ''\)/);
    const alvos = [...t.matchAll(/ALTER TABLE (\w+) DROP CONSTRAINT (\w+)/g)].map((x) => `${x[1]}.${x[2]}`);
    expect(alvos).toEqual([
      'SGH_SUP_OPME_ETAPA.SGH_CK_SUP_OPME_ETAPA_MOTIVO',
      'SGH_SUP_OPME_RASTREIO.SGH_CK_SUP_OPME_RAS_LOTE',
      'SGH_SUP_OPME_RASTREIO.SGH_CK_SUP_OPME_RAS_SEMAUT',
      'SGH_SUP_CONSIGNADO.SGH_CK_SUP_CONSIG_REMESSA',
      'SGH_SUP_CONSIGNADO.SGH_CK_SUP_CONSIG_DEVOL',
      'SGH_SUP_MANIPULACAO.SGH_CK_SUP_MANIP_REPROVADA',
    ]);
    // Cada regra derrubada volta na mesma correção (o mesmo nome).
    for (const a of alvos) expect(t).toContain(`ADD CONSTRAINT ${a.split('.')[1]} CHECK`);
    expect(t).not.toMatch(/ALTER TABLE (?!SGH_)/);
  });

  it('M46 (etapa 4, correção 0968): as chaves únicas com coluna nula viram índice único por expressão (nome _P)', () => {
    const [s968] = scripts.filter((x) => x.numero === 968);
    expect(s968?.arquivo).toBe('suprimentos/sgh/0968_unicos_com_nulo.sql');
    const t = (s968?.comandos ?? []).join('\n');
    expect(t).toContain('ALTER TABLE SGH_SUP_CONSIGNADO DROP CONSTRAINT SGH_UQ_SUP_CONSIG_CONSUMO');
    expect(t).toContain(
      'CREATE UNIQUE INDEX SGH_UQ_SUP_CONSIG_CONSUMO_P ON SGH_SUP_CONSIGNADO COMPUTED BY (CASE WHEN ID_OPME_RASTREIO IS NOT NULL THEN',
    );
    expect(t).toContain('ALTER TABLE SGH_SUP_MANIPULACAO DROP CONSTRAINT SGH_UQ_SUP_MANIP_LANC');
    expect(t).toContain(
      'CREATE UNIQUE INDEX SGH_UQ_SUP_MANIP_LANC_P ON SGH_SUP_MANIPULACAO COMPUTED BY (CASE WHEN ID_GELANSAI IS NOT NULL THEN',
    );
    expect(t).not.toMatch(/ALTER TABLE (?!SGH_)|ON (?!SGH_)[A-Z]/);
  });

  it('M45 (etapa 4): SAE, prescrição de enfermagem, receita do enfermeiro e vacina (0457) só de inclusão; não feita com motivo e estorno uma vez só no banco', () => {
    const [s457] = scripts.filter((x) => x.numero === 457);
    expect(s457?.arquivo).toBe('enfermagem/sgh/0457_sae.sql');
    const todos = (s457?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_SAE_TERMO',
      'SGH_PEP_SAE',
      'SGH_PEP_SAE_ITEM',
      'SGH_PEP_SAE_ATIVIDADE',
      'SGH_PEP_PRESC_ENFERMEIRO',
      'SGH_PEP_VACINA_APLICADA',
    ]);
    // Regra 8: a atividade não feita exige motivo; o estorno uma vez só; o horário uma vez por geração.
    expect(todos).toContain("(FEITA = 'T' OR CHAR_LENGTH(TRIM(MOTIVO)) >= 5)");
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_SAE_ATIV_ESTORNO UNIQUE (CHAVE_ESTORNO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_SAE_ATIV_HORARIO UNIQUE (CHAVE_HORARIO)');
    // Regra 18: o prazo do envio em 24 horas e o lote na validade.
    expect(todos).toContain('ENVIO_PRAZO = DATEADD(24 HOUR TO APLICADA_EM)');
    for (const t of [
      'SGH_PEP_SAE_TERMO',
      'SGH_PEP_SAE',
      'SGH_PEP_SAE_ITEM',
      'SGH_PEP_SAE_ATIVIDADE',
      'SGH_PEP_PRESC_ENFERMEIRO',
      'SGH_PEP_VACINA_APLICADA',
    ])
      expect(todos).toContain(`GRANT SELECT, INSERT ON ${t} TO ROLE SGH_APLICACAO`);
    expect(todos).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bDROP\b|REFERENCES/);
    // As correções: o motivo presente na checagem não feita e no estorno (0943, o CHECK do tamanho aceitava o nulo) e a
    // coluna do tipo do protocolo expandida (0944, "institucional" tem 13 caracteres).
    const [s943] = scripts.filter((x) => x.numero === 943);
    expect(s943?.arquivo).toBe('enfermagem/sgh/0943_sae_motivo.sql');
    expect(s943?.comandos).toEqual([
      "ALTER TABLE SGH_PEP_SAE_ATIVIDADE ADD CONSTRAINT SGH_CK_PEP_SAE_ATIV_MOTIVO CHECK ((TIPO = 'checagem' AND (FEITA = 'T' OR MOTIVO IS NOT NULL)) OR (TIPO = 'estorno' AND MOTIVO IS NOT NULL))",
    ]);
    const [s944] = scripts.filter((x) => x.numero === 944);
    expect(s944?.arquivo).toBe('enfermagem/sgh/0944_presc_enfermeiro_tipo.sql');
    expect(s944?.comandos).toEqual([
      'ALTER TABLE SGH_PEP_PRESC_ENFERMEIRO ALTER COLUMN PROTOCOLO_TIPO TYPE VARCHAR(13)',
    ]);
  });

  it('M45 (etapa 2): escores, regras versionadas, reavaliação e cuidados (0452), índices de UTI (0453) e classificação de pacientes (0454); só a reavaliação e a validação do índice mudam de situação; nenhum DELETE', () => {
    const tabelas = (n: number) =>
      [
        ...(scripts.find((x) => x.numero === n)?.comandos ?? [])
          .join('\n')
          .matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g),
      ].map((m) => m[1]);
    expect(scripts.find((x) => x.numero === 452)?.arquivo).toBe('enfermagem/sgh/0452_escore.sql');
    expect(scripts.find((x) => x.numero === 453)?.arquivo).toBe('pep/sgh/0453_indice_uti.sql');
    expect(scripts.find((x) => x.numero === 454)?.arquivo).toBe('enfermagem/sgh/0454_classif_pac.sql');
    expect(tabelas(452)).toEqual([
      'SGH_PEP_ESCORE_REGRA',
      'SGH_PEP_ESCORE',
      'SGH_PEP_REAVALIACAO',
      'SGH_PEP_ESCORE_CUIDADO',
    ]);
    expect(tabelas(453)).toEqual(['SGH_PEP_INDICE_UTI']);
    expect(tabelas(454)).toEqual(['SGH_PEP_CLASSIF_PAC']);
    const todos = [452, 453, 454]
      .map((n) => (scripts.find((x) => x.numero === n)?.comandos ?? []).join('\n'))
      .join('\n');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_ESCORE TO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_ESCORE_REGRA TO');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PEP_REAVALIACAO TO');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_PEP_INDICE_UTI TO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PEP_CLASSIF_PAC TO');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PEP_CLASSIF_PAC_TURNO UNIQUE');
    expect(todos).not.toMatch(/DELETE|DROP/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M45 (etapa 5): nutrição e serviço social (0458) e o mapa de dietas (0459) só de inclusão, salvo o encerramento do acompanhante', () => {
    const [s458] = scripts.filter((x) => x.numero === 458);
    const [s459] = scripts.filter((x) => x.numero === 459);
    expect(s458?.arquivo).toBe('pep/sgh/0458_pep_nutricao_social.sql');
    expect(s459?.arquivo).toBe('internacao/sgh/0459_mapa_dieta.sql');
    const a = (s458?.comandos ?? []).join('\n');
    const b = (s459?.comandos ?? []).join('\n');
    expect([...a.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PEP_NUTRI_TRIAGEM',
      'SGH_PEP_NUTRI_TERAPIA',
      'SGH_PEP_SOCIAL',
    ]);
    expect([...b.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_HOT_MAPA_DIETA',
      'SGH_HOT_MAPA_DIETA_ITEM',
      'SGH_HOT_DIETA_ACOMP',
    ]);
    // Regra 11: um retrato por unidade, refeição e dia (nunca regravado); uma refeição de acompanhante vigente.
    expect(b).toContain('CONSTRAINT SGH_UQ_HOT_MAPA_DIETA UNIQUE (HOSPITAL, UNIDADE, REFEICAO, DATA_REF)');
    expect(b).toContain('CONSTRAINT SGH_UQ_HOT_DIETA_ACOMP_VIG UNIQUE (VIGENTE)');
    expect(a).toContain('GRANT SELECT, INSERT ON SGH_PEP_NUTRI_TRIAGEM TO ROLE SGH_APLICACAO');
    expect(a).toContain('GRANT SELECT, INSERT ON SGH_PEP_SOCIAL TO ROLE SGH_APLICACAO');
    expect(b).toContain('GRANT SELECT, INSERT ON SGH_HOT_MAPA_DIETA_ITEM TO ROLE SGH_APLICACAO');
    expect(b).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_HOT_DIETA_ACOMP TO ROLE SGH_APLICACAO');
    expect(`${a}\n${b}`).not.toMatch(/\bDELETE\b/);
    // A barreira social aponta a barreira do NIR (SGH_); nenhuma FK para o legado.
    for (const m of `${a}\n${b}`.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M44 (etapa 3): protocolos gerenciados e regulação estadual num script só, tudo só de inclusão; nada com UPDATE nem DELETE', () => {
    const [s449] = scripts.filter((x) => x.numero === 449);
    expect(s449?.arquivo).toBe('recepcao/sgh/0449_pa_protoc_gerenciado_e_regulacao.sql');
    const todos = (s449?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PA_PROTOC_GERENCIADO',
      'SGH_PA_PROTOC_PACIENTE',
      'SGH_PA_PROTOC_PAC_EVT',
      'SGH_INT_REGULACAO',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_PA_PROTOC_GER_VERSAO UNIQUE (HOSPITAL, TIPO, VERSAO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PA_PROTOC_PAC_TIPO UNIQUE (HOSPITAL, ID_ATCABECATEND, TIPO)');
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_PA_PROTOC_PAC_EVT UNIQUE (ID_PROTOC_PACIENTE, TIPO_EVENTO, CODIGO)',
    );
    expect(todos).toContain('CONSTRAINT SGH_UQ_INT_REGULACAO_SUCEDE UNIQUE (HOSPITAL, SUCEDE)');
    // Regra 8: a meta perdida tem o motivo; a cumprida, a hora real.
    expect(todos).toContain("CHECK (SITUACAO <> 'perdida' OR MOTIVO IS NOT NULL)");
    expect(todos).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE)\b/);
    expect(todos).not.toMatch(/\bDELETE\b/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M50 (etapa 5): a portaria só com objetos SGH_ (0955, fora da faixa 0500–0509), sem DELETE nem FK para o legado; as chaves "uma vez só" de uma coluna; o evento da catraca só de inclusão', () => {
    const [s955] = scripts.filter((x) => x.numero === 955);
    expect(s955?.arquivo).toBe('internacao/sgh/0955_portaria.sql');
    const todos = (s955?.comandos ?? []).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_HOT_VISITANTE',
      'SGH_HOT_VISITA',
      'SGH_HOT_VISITA_TRAVA',
      'SGH_HOT_REGRA_VISITA',
      'SGH_HOT_BLOQUEIO_VISITA',
      'SGH_HOT_ACOMPANHANTE',
      'SGH_HOT_TERMINAL',
      'SGH_HOT_CATRACA_EVT',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_VISITANTE_DOC UNIQUE (CHAVE_DOCUMENTO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_VISITA_ABERTA UNIQUE (CHAVE_ABERTA)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_VISITA_CRACHA UNIQUE (CRACHA)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_ACOMP_VIGENTE UNIQUE (CHAVE_VIGENTE)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_HOT_CATRACA_EVT UNIQUE (CHAVE_EVENTO)');
    expect(todos).toContain("CHECK (MOTIVO <> 'judicial' OR DOCUMENTO IS NOT NULL)");
    expect(todos).toContain('CONSTRAINT SGH_PK_HOT_VISITA_TRAVA PRIMARY KEY (HOSPITAL, REG)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_HOT_CATRACA_EVT TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b|\bDROP\b|REFERENCES/);
  });

  it('M56 (etapa 4): a rede credenciada com um prestador por documento e um hospital da Rede por estabelecimento da operadora, e o movimento do RPS só de inclusão; nada com DELETE', () => {
    const doM56 = scripts.filter((x) => (x.numero >= 568 && x.numero <= 569) || x.numero === 956);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0568_ope_prestador.sql',
      'operadora/sgh/0569_ope_prestador_mov.sql',
      'operadora/sgh/0956_ope_prestador_hospital_unico.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_PRESTADOR',
      'SGH_OPE_PRESTADOR_MOV',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_PRESTADOR_DOC UNIQUE (HOSPITAL, DOCUMENTO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_PRESTADOR_HOSP UNIQUE (HOSPITAL, ESTABELECIMENTO)');
    // A chave composta trata (estabelecimento, nulo) como repetida no Firebird: o 0956 a troca pelo índice sobre a
    // expressão, nula fora do próprio hospital (várias nulas aceitas).
    expect(todos).toContain('ALTER TABLE SGH_OPE_PRESTADOR DROP CONSTRAINT SGH_UQ_OPE_PRESTADOR_HOSP');
    expect(todos).toContain(
      "CREATE UNIQUE INDEX SGH_IDX_OPE_PREST_HOSP_UNICO ON SGH_OPE_PRESTADOR COMPUTED BY (CASE WHEN ESTABELECIMENTO IS NOT NULL THEN HOSPITAL || '|' || ESTABELECIMENTO END)",
    );
    expect(todos).toContain('CHECK (CONTRATO_FIM IS NULL OR CONTRATO_FIM >= CONTRATO_INICIO)');
    expect(todos).toContain('CHECK (MOVIMENTO BETWEEN 1 AND 4)');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_OPE_PRESTADOR TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_PRESTADOR_MOV TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M56 (etapa 3): a cobrança com uma mensalidade por contrato e competência fora das canceladas, os itens só de inclusão e o reajuste vigente único; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => (x.numero >= 565 && x.numero <= 567) || x.numero === 957);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0565_ope_cobranca.sql',
      'operadora/sgh/0566_ope_cobranca_item.sql',
      'operadora/sgh/0567_ope_reajuste.sql',
      'operadora/sgh/0957_ope_cobranca_competencia.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_COBRANCA',
      'SGH_OPE_COBRANCA_ITEM',
      'SGH_OPE_REAJUSTE',
    ]);
    // Regra 6: os 4 tipos do domínio; a parcela de acordo com o acordo de origem.
    expect(todos).toContain('CHECK (TIPO BETWEEN 1 AND 4 AND (TIPO <> 4 OR (ACORDO_ORIGEM IS NOT NULL');
    expect(todos).toContain(
      "CREATE UNIQUE INDEX SGH_IDX_OPE_COBR_MENSAL_UNICA ON SGH_OPE_COBRANCA COMPUTED BY (CASE WHEN TIPO = 1 AND SITUACAO <> 'cancelada' THEN CAST(ID_CONTRATO AS VARCHAR(20)) || '|' || COMPETENCIA END)",
    );
    expect(todos).toContain(
      "CREATE UNIQUE INDEX SGH_IDX_OPE_REAJ_VIGENTE_UNICO ON SGH_OPE_REAJUSTE COMPUTED BY (CASE WHEN SITUACAO = 'vigente' THEN CAST(ID_CONTRATO AS VARCHAR(20)) || '|' || COMPETENCIA END)",
    );
    expect(todos).toContain("(SITUACAO <> 'paga' OR (PAGO_EM IS NOT NULL AND VALOR_PAGO IS NOT NULL))");
    // O 0957 troca o CHECK da competência por SUBSTRING (o Firebird recusou o SIMILAR TO com quantificador).
    expect(todos).toContain('ALTER TABLE SGH_OPE_COBRANCA DROP CONSTRAINT SGH_CK_OPE_COBR_COMPETENCIA');
    expect(todos).toContain('ALTER TABLE SGH_OPE_REAJUSTE DROP CONSTRAINT SGH_CK_OPE_REAJ_COMPETENCIA');
    expect(todos).toContain("SUBSTRING(COMPETENCIA FROM 6 FOR 2) BETWEEN '01' AND '12'");
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_COBRANCA_ITEM TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_OPE_COBRANCA TO ROLE SGH_APLICACAO');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_OPE_/);
    expect(todos).not.toMatch(/GRANT[^;]*\bDELETE\b/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M56 (etapa 5): a autorização com o protocolo e a senha únicos, os itens, o histórico só de inclusão e o auditor ativo uma vez por operadora; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => x.numero === 958 || x.numero === 959);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0958_ope_autorizacao.sql',
      'operadora/sgh/0959_ope_autorizacao_evt_auditor.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_AUTORIZACAO',
      'SGH_OPE_AUTORIZACAO_ITEM',
      'SGH_OPE_AUTORIZACAO_EVT',
      'SGH_OPE_AUDITOR',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_AUT_PROTOCOLO UNIQUE (PROTOCOLO)');
    expect(todos).toContain('CREATE UNIQUE INDEX SGH_IDX_OPE_AUT_SENHA ON SGH_OPE_AUTORIZACAO (SENHA)');
    expect(todos).toContain('SGH_CK_OPE_AUT_NEGATIVA CHECK');
    expect(todos).toContain(
      "COMPUTED BY (CASE WHEN SITUACAO = 'ativo' THEN CAST(ID_OPERADORA AS VARCHAR(20)) || '|' || LOGIN END)",
    );
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_AUTORIZACAO_EVT TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_OPE_AUTORIZACAO TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    expect(todos).not.toMatch(/SIMILAR TO/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M56 (etapa 6): as contas médicas com o protocolo e o arquivo únicos, as guias com o recurso, os itens com a glosa e o motivo, o histórico só de inclusão; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => x.numero === 950 || x.numero === 951);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0950_ope_conta.sql',
      'operadora/sgh/0951_ope_conta_evt.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_CONTA',
      'SGH_OPE_CONTA_GUIA',
      'SGH_OPE_CONTA_ITEM',
      'SGH_OPE_CONTA_EVT',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_CONTA_PROTOCOLO UNIQUE (PROTOCOLO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_CONTA_ARQUIVO UNIQUE (ID_OPERADORA, ARQUIVO_SHA256)');
    expect(todos).toContain("CHECK (VERSAO_TISS = '04.03.00')");
    expect(todos).toContain('MOTIVO_GLOSA BETWEEN 1000 AND 9999');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_CONTA_EVT TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT, UPDATE ON SGH_OPE_CONTA TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    expect(todos).not.toMatch(/SIMILAR TO/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_OPE_/);
  });

  it('M56 (etapa 7): os envios à ANS com o sequencial único, o arquivo com o SHA-256, o recibo só na ANS, o aviso de ressarcimento único, os itens com o resultado e a decisão, o histórico só de inclusão e o complemento do SIB com o CCO único; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => x.numero === 952 || x.numero === 953);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0952_ope_envio_ans.sql',
      'operadora/sgh/0953_ope_benef_sib.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_ENVIO_ANS',
      'SGH_OPE_ENVIO_ANS_ITEM',
      'SGH_OPE_ENVIO_ANS_EVT',
      'SGH_OPE_BENEF_SIB',
    ]);
    expect(todos).toContain(
      'CONSTRAINT SGH_UQ_OPE_ENVIO_ANS_SEQ UNIQUE (ID_OPERADORA, OBRIGACAO, COMPETENCIA, SEQUENCIAL)',
    );
    expect(todos).toContain("(DESTINO = 'simulador' AND RECIBO IS NULL)");
    expect(todos).toContain('CREATE UNIQUE INDEX SGH_IDX_OPE_ENVIO_ANS_AVISO');
    expect(todos).toContain('CREATE UNIQUE INDEX SGH_IDX_OPE_BENEF_SIB_CCO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_ENVIO_ANS_EVT TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    expect(todos).not.toMatch(/SIMILAR TO/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_OPE_/);
  });

  it('M56 (etapa 8): o protocolo de atendimento com o número único, a NIP, a ouvidoria com a prorrogação e a origem, a resposta com o fundamento, a escrita, o histórico só de inclusão e a conta do portal com o e-mail único e o resumo da ativação; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => x.numero === 960 || x.numero === 961);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0960_ope_protocolo.sql',
      'operadora/sgh/0961_ope_portal_acesso.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_PROTOCOLO',
      'SGH_OPE_PROTOCOLO_EVT',
      'SGH_OPE_PORTAL_ACESSO',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_PROT_NUMERO UNIQUE (PROTOCOLO)');
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_PORTAL_LOGIN UNIQUE (HOSPITAL, LOGIN)');
    expect(todos).toContain('CREATE UNIQUE INDEX SGH_IDX_OPE_PORTAL_ATIVACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_PROTOCOLO_EVT TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/\bDELETE\b/);
    expect(todos).not.toMatch(/SIMILAR TO/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_OPE_/);
  });

  it('M52 (etapa 1): vínculo com o CPF só em HMAC e cifrado, histórico só de inclusão, dependentes, validade do conselho e o retrato diário; nenhuma FK para o legado, nada com DELETE', () => {
    const doM52 = scripts.filter((x) => x.numero >= 520 && x.numero <= 525);
    expect(doM52.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0520_pes_vinculo.sql',
      'pessoas/sgh/0521_pes_historico.sql',
      'pessoas/sgh/0522_pes_dependente.sql',
      'pessoas/sgh/0523_pes_habilitacao.sql',
      'pessoas/sgh/0524_pes_conselho_dia.sql',
      'pessoas/sgh/0525_pes_lotacao_unidade_e_fim_dependente.sql',
    ]);
    const todos = doM52.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_VINCULO',
      'SGH_PES_HISTORICO',
      'SGH_PES_DEPENDENTE',
      'SGH_PES_HABILITACAO',
      'SGH_PES_CONSELHO_DIA',
    ]);
    // D-CPF-52: o CPF nunca em claro (HMAC para a busca exata e o cifrado).
    expect(todos).toMatch(/CPF_HMAC\s+CHAR\(64\)\s+NOT NULL/);
    expect(todos).not.toMatch(/\bCPF\s+(CHAR|NUMERIC|VARCHAR)/);
    // O histórico é só de inclusão; o desligamento tem data, motivo e não antecede a admissão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_HISTORICO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('DESLIGAMENTO >= ADMISSAO');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PES_HABILITACAO_REG UNIQUE (HOSPITAL, ID_TBCBOPRO)');
    // Corretor: a lista por unidade com índice próprio e o fim do dependente com motivo (nunca apagado).
    expect(todos).toContain(
      'CREATE INDEX SGH_IDX_PES_VINCULO_UN ON SGH_PES_VINCULO (HOSPITAL, ID_TBUNIDAD, ID)',
    );
    expect(todos).toContain('(ATE IS NULL OR (MOTIVO_FIM IS NOT NULL AND ENCERRADO_POR IS NOT NULL))');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    expect(todos).not.toMatch(/GRANT[^;]*\bDELETE\b/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M52 (etapa 3): troca com os dois lados e a trilha de cada passo, acionamento do sobreaviso com o prazo e o dimensionamento só de inclusão; FK só entre SGH_PES_, nada com DELETE', () => {
    const doM52 = scripts.filter((x) => x.numero >= 991 && x.numero <= 993);
    expect(doM52.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0991_pes_troca.sql',
      'pessoas/sgh/0992_pes_acionamento.sql',
      'pessoas/sgh/0993_pes_dimensionamento.sql',
    ]);
    const todos = doM52.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_TROCA',
      'SGH_PES_ACIONAMENTO',
      'SGH_PES_DIMENSIONAMENTO',
    ]);
    // Regra 8: a reprovação tem motivo; a decisão tem quem e quando; o colega é outro vínculo.
    expect(todos).toContain("CHECK (ESTADO <> 'reprovada' OR MOTIVO_DECISAO IS NOT NULL)");
    expect(todos).toContain('CHECK (ID_VINCULO_COLEGA <> ID_VINCULO)');
    // Regra 10: o prazo de chegada não vem antes do acionamento.
    expect(todos).toContain('CHECK (PRAZO_CHEGADA >= ACIONADO_EM)');
    // Regra 9: IST de pelo menos 15%; a equipe fecha; o cálculo é só de inclusão.
    expect(todos).toContain('CHECK (IST >= 0.15)');
    expect(todos).toContain('CHECK (ENFERMEIROS + TECNICOS = TOTAL_PROF)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_DIMENSIONAMENTO TO ROLE SGH_APLICACAO');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M52 (etapa 2): regimes com a vigência só de inclusão, escala com o estado e a cobertura, plantões com o intervalo e a trilha da escala só de inclusão; FK só entre SGH_PES_, nada com DELETE', () => {
    const doM52 = scripts.filter((x) => (x.numero >= 526 && x.numero <= 528) || x.numero === 985);
    expect(doM52.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0526_pes_regime.sql',
      'pessoas/sgh/0527_pes_escala.sql',
      'pessoas/sgh/0528_pes_plantao.sql',
      'pessoas/sgh/0985_pes_vinculo_matricula_unica.sql',
    ]);
    const todos = doM52.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_REGIME',
      'SGH_PES_REGIME_VINCULO',
      'SGH_PES_ESCALA',
      'SGH_PES_PLANTAO',
      'SGH_PES_ESCALA_EVENTO',
    ]);
    // Regra 5: descanso abaixo de 11 h só com acordo; vigência e trilha só de inclusão.
    expect(todos).toContain('CHECK (MIN_DESCANSO >= 660 OR ACORDO IS NOT NULL)');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_REGIME_VINCULO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_ESCALA_EVENTO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('CHECK (FIM > INICIO)');
    expect(todos).toContain('CREATE INDEX SGH_IDX_PES_PLANTAO_INICIO ON SGH_PES_PLANTAO (HOSPITAL, INICIO)');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    // Correção da etapa 1: a matrícula única só pela coluna (várias nulas no estabelecimento).
    expect(todos).toContain('ADD CONSTRAINT SGH_UQ_PES_VINCULO_MAT UNIQUE (MATRICULA)');
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M52 (etapa 5, SESMT): ocupacional e vacinas só de inclusão, acidente com a sorologia, riscos por função e entregas de EPI; nenhuma FK para o legado, nada com DELETE', () => {
    const doF5 = scripts.filter((x) => x.numero === 529);
    expect(doF5.map((x) => x.arquivo)).toEqual(['pessoas/sgh/0529_pes_sesmt.sql']);
    const todos = doF5.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_OCUPACIONAL',
      'SGH_PES_VACINA',
      'SGH_PES_ACIDENTE',
      'SGH_PES_ACID_SOROLOGIA',
      'SGH_PES_RISCO_FUNCAO',
      'SGH_PES_EPI_ENTREGA',
    ]);
    // Regra 16 e dado de saúde: o prontuário ocupacional e as vacinas nunca mudam (a correção é a retificação).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_OCUPACIONAL TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_VACINA TO ROLE SGH_APLICACAO');
    // Regra 19: o CA vencido na data da entrega é recusado também pelo banco.
    expect(todos).toContain('CA_VALIDADE >= DATA_REGISTRO');
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    expect(todos).not.toMatch(/\bDELETE\b/);
    // Nenhum identificador de paciente na fonte do acidente com material biológico.
    expect(todos).not.toMatch(/\b(PACIENTE|PRONTUARIO|REG_PAC|ID_TBPACIENTE)\b/);
  });

  it('M52 (etapa 4, ponto): arquivo do relógio com o hash, marcações e trilha do período só de inclusão, ajuste com decisão por outra pessoa, regra e movimentos do banco (saldo = soma); FK só entre SGH_PES_, nada com DELETE', () => {
    const doF4 = scripts.filter((x) => x.numero >= 986 && x.numero <= 989);
    expect(doF4.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0986_pes_afd_marcacao.sql',
      'pessoas/sgh/0987_pes_ponto_ajuste.sql',
      'pessoas/sgh/0988_pes_ponto_fechamento.sql',
      'pessoas/sgh/0989_pes_banco_horas.sql',
    ]);
    const todos = doF4.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_AFD_ARQUIVO',
      'SGH_PES_MARCACAO',
      'SGH_PES_PONTO_AJUSTE',
      'SGH_PES_PONTO_FECHAMENTO',
      'SGH_PES_BANCO_REGRA',
      'SGH_PES_BANCO_HORAS',
    ]);
    // Regra 11: a marcação original nunca muda; regra 14: o saldo é a soma dos movimentos (só inclusão).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_MARCACAO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_BANCO_HORAS TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_PONTO_FECHAMENTO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_AFD_ARQUIVO TO ROLE SGH_APLICACAO');
    expect(todos).toContain('CHECK (DECIDIDO_POR IS NULL OR UPPER(DECIDIDO_POR) <> UPPER(PEDIDO_POR))');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PES_MARCACAO_NSR UNIQUE (HOSPITAL, NUMERO_REP, NSR)');
    // D-CPF-52: o CPF do empregado só como HMAC.
    expect(todos).toMatch(/CPF_HMAC\s+CHAR\(64\)\s+NOT NULL/);
    expect(todos).not.toMatch(/\bCPF\s+(CHAR|NUMERIC|VARCHAR)/);
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M52 (etapa 6): cursos, turmas, lista de presença, POP versionado e a ciência só de inclusão; o realizado com a decisão por outra pessoa no banco e as tarifas; a origem plantão no lançamento do repasse; nada com DELETE', () => {
    const doF6 = scripts.filter((x) => x.numero >= 994 && x.numero <= 995);
    expect(doF6.map((x) => x.arquivo)).toEqual([
      'pessoas/sgh/0994_pes_treinamento.sql',
      'pessoas/sgh/0995_pes_plantao_realizado.sql',
    ]);
    const todos = doF6.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_PES_CURSO',
      'SGH_PES_POP',
      'SGH_PES_TREINAMENTO',
      'SGH_PES_TREIN_PARTICIPANTE',
      'SGH_PES_POP_CIENCIA',
      'SGH_PES_PLANTAO_REALIZADO',
      'SGH_PES_TARIFA_PLANTAO',
    ]);
    // Regra 20: a ciência do POP nunca muda nem some; uma por versão e vínculo.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_PES_POP_CIENCIA TO ROLE SGH_APLICACAO');
    expect(todos).toContain('CONSTRAINT SGH_UQ_PES_POP_CIENCIA UNIQUE (ID_POP, ID_VINCULO)');
    expect(todos).toContain('CHECK (VERSAO_POP = 1 OR ALTERACOES IS NOT NULL)');
    // Seção 5: quatro olhos também no banco; o lançado é aprovado e tem valor.
    expect(todos).toContain('UPPER(DECIDIDO_POR) <> UPPER(INFORMADO_POR)');
    expect(todos).toContain("CHECK (ORIGEM IN ('apuracao', 'ajuste', 'estorno', 'plantao'))");
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_PES_/);
    for (const m of todos.matchAll(/ALTER TABLE (\w+)/g)) expect(m[1]).toBe('SGH_REP_LANCAMENTO');
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M56 (etapa 2): operadora, produto, contrato e beneficiário com concorrência por versão e as vias da carteirinha só de inclusão; nenhuma FK para o legado, nada com DELETE', () => {
    const doM56 = scripts.filter((x) => x.numero >= 560 && x.numero <= 564);
    expect(doM56.map((x) => x.arquivo)).toEqual([
      'operadora/sgh/0560_ope_operadora.sql',
      'operadora/sgh/0561_ope_produto.sql',
      'operadora/sgh/0562_ope_contrato.sql',
      'operadora/sgh/0563_ope_beneficiario.sql',
      'operadora/sgh/0564_ope_carteirinha.sql',
    ]);
    const todos = doM56.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_OPE_OPERADORA',
      'SGH_OPE_PRODUTO',
      'SGH_OPE_CONTRATO',
      'SGH_OPE_BENEFICIARIO',
      'SGH_OPE_CARTEIRINHA',
    ]);
    // Regra 2: o plano tem registro e segmentação; o cartão de desconto, nenhum dos dois.
    expect(todos).toContain(
      "CHECK ((NATUREZA = 'plano' AND REGISTRO_ANS IS NOT NULL AND SEGMENTACAO IS NOT NULL) OR (NATUREZA = 'cartaoDesconto' AND REGISTRO_ANS IS NULL AND SEGMENTACAO IS NULL))",
    );
    // Titular sem titular acima; dependente com titular. Carteirinha única.
    expect(todos).toContain('CONSTRAINT SGH_UQ_OPE_BENEF_CARTEIRINHA UNIQUE (CARTEIRINHA)');
    expect(todos).toMatch(/VINCULO = 1 AND ID_TITULAR IS NULL/);
    // Regra 8: o paciente do hospital só pelo ID, sem FK.
    expect(todos).toContain('ID_RICADPAC         INTEGER'.replace(/\s+/g, ' '));
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_OPE_/);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_OPE_CARTEIRINHA TO ROLE SGH_APLICACAO');
    expect(todos).not.toMatch(/GRANT[^;]*\bDELETE\b/);
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M39: a lista para ligar o setor e as recusas por horário ocupado no uso do dia; nada com DELETE', () => {
    const doM39 = scripts.filter((x) => x.numero >= 390 && x.numero <= 399);
    expect(doM39.map((x) => x.arquivo)).toEqual([
      'config/sgh/0390_coex_ligar.sql',
      'config/sgh/0391_coex_uso_dia_ocupado.sql',
    ]);
    const todos = doM39.flatMap((x) => x.comandos).join('\n');
    expect([...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'SGH_CFG_COEX_LIGAR',
    ]);
    expect(todos).toContain('CONSTRAINT SGH_PK_CFG_COEX_LIGAR PRIMARY KEY (HOSPITAL, SETOR, ITEM)');
    expect(todos).toContain("CHECK (ITEM <> 'operacoes-conferidas')");
    expect(todos).toContain(
      'ALTER TABLE SGH_CFG_COEX_USO_DIA ADD RECUSAS_OCUPADO INTEGER DEFAULT 0 NOT NULL',
    );
    expect(todos).not.toMatch(/\bDELETE\b/);
  });

  it('M37: as 9 tabelas do painel de migração (setor e composição, trilha e conclusão, retrato de conexões, uso do dia, lote, condução e chamado); nada com DELETE; a conclusão do treino só de inclusão', () => {
    const doM37 = scripts.filter((x) => x.numero >= 370 && x.numero <= 379);
    expect(doM37.map((x) => x.arquivo)).toEqual([
      'config/sgh/0370_coex_setor.sql',
      'config/sgh/0371_coex_trilha.sql',
      'config/sgh/0372_coex_conexao.sql',
      'config/sgh/0373_coex_uso_dia.sql',
      'config/sgh/0374_coex_lote.sql',
      'config/sgh/0375_coex_conducao.sql',
      'config/sgh/0376_chamado.sql',
    ]);
    const todos = doM37.flatMap((x) => x.comandos).join('\n');
    const tabelas = [...todos.matchAll(/CREATE TABLE (SGH_[A-Z_]+)/g)].map((m) => m[1]);
    expect(tabelas).toEqual([
      'SGH_CFG_COEX_SETOR',
      'SGH_CFG_COEX_SETOR_UNID',
      'SGH_CFG_COEX_TRILHA',
      'SGH_CFG_COEX_TREINO',
      'SGH_CFG_COEX_CONEXAO',
      'SGH_CFG_COEX_USO_DIA',
      'SGH_CFG_COEX_LOTE',
      'SGH_CFG_COEX_CONDUCAO',
      'SGH_CFG_CHAMADO',
    ]);
    expect(doM37.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CFG_COEX_TREINO TO ROLE SGH_APLICACAO');
    // Regra 3: ninguém registra a própria conclusão; regra 7: S1 fora de "aberto" tem comandante.
    expect(todos).toContain('CONSTRAINT SGH_CK_COEX_TREINO_A_SI CHECK (REGISTRADO_POR <> LOGIN)');
    expect(todos).toContain(
      "CONSTRAINT SGH_CK_CHAMADO_S1 CHECK (SEVERIDADE <> 'S1' OR SITUACAO = 'aberto' OR COMANDANTE IS NOT NULL)",
    );
    // Nenhuma FK para tabela do legado (só entre as SGH_ do marco).
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
  });

  it('M24: as 9 tabelas da prescrição só de inclusão (nenhum UPDATE nem DELETE para a aplicação)', () => {
    const doM24 = scripts.filter((x) => x.numero >= 240 && x.numero <= 249);
    expect(doM24.map((x) => x.arquivo)).toEqual([
      'pep/sgh/0240_pep_presc_ext.sql',
      'pep/sgh/0241_pep_alerta_decisao.sql',
      'pep/sgh/0242_pep_regra_alerta.sql',
      'pep/sgh/0243_pep_interacao.sql',
      'pep/sgh/0244_pep_ficha_antimicro.sql',
      'pep/sgh/0245_pep_reconciliacao.sql',
      'pep/sgh/0246_pep_presc_futura.sql',
      'pep/sgh/0247_pep_grade_classe.sql',
      'pep/sgh/0248_pep_presc_doc.sql',
    ]);
    const grants = doM24.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toHaveLength(9);
    for (const g of grants)
      expect(g).toMatch(/^GRANT SELECT, INSERT ON SGH_PEP_[A-Z_]+ TO ROLE SGH_APLICACAO$/);
  });

  it('M19: extensão e eventos da senha, fila por gerador e dispositivos; nada com DELETE; eventos só de inclusão', () => {
    // O 0199 é do M18 (correção da revisão: a faixa 0180–0189 acabou; ligação única da cirurgia, teste próprio).
    const doM19 = scripts.filter((x) => x.numero >= 190 && x.numero <= 199 && x.numero !== 199);
    expect(doM19.map((x) => x.arquivo)).toEqual([
      'recepcao/sgh/0190_senha_ext.sql',
      'recepcao/sgh/0191_senha_evento.sql',
      'recepcao/sgh/0192_fila_cfg.sql',
      'acesso/sgh/0193_dispositivo.sql',
    ]);
    const grants = doM19.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_REC_SENHA_EXT TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_REC_SENHA_EVENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_REC_FILA_CFG TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_ACESSO_DISPOSITIVO TO ROLE SGH_APLICACAO',
    ]);
  });

  it('M20: extensão, desfecho, etapas e observação do PA, não identificado e impressos; nada com DELETE; etapas, desfecho e impressos só de inclusão', () => {
    const doM20 = scripts.filter((x) => x.numero >= 200 && x.numero <= 209);
    expect(doM20.map((x) => x.arquivo)).toEqual([
      'atendimento/sgh/0200_atd_ext.sql',
      'atendimento/sgh/0201_desfecho.sql',
      'atendimento/sgh/0202_pa_etapa.sql',
      'atendimento/sgh/0203_pa_observacao.sql',
      'cadastro/sgh/0204_nao_identificado.sql',
      'atendimento/sgh/0205_atd_impresso.sql',
    ]);
    const grants = doM20.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_ATD_EXT TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_ATD_DESFECHO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PA_ETAPA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_PA_OBSERVACAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT, UPDATE ON SGH_ATD_NAO_IDENTIFICADO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_ATD_IMPRESSO TO ROLE SGH_APLICACAO',
    ]);
    expect(doM20.flatMap((x) => x.comandos).some((c) => /\bDELETE\b/i.test(c))).toBe(false);
  });

  it('M17: extensões da agenda só do novo; marcação, cancelamento, confirmação e horários das gerações e dos bloqueios só de inclusão; nada com DELETE', () => {
    const doM17 = scripts.filter((x) => x.numero >= 180 && x.numero <= 187);
    expect(doM17.map((x) => x.arquivo)).toEqual([
      'agenda/sgh/0180_agenda_ligacao.sql',
      'agenda/sgh/0181_escala_vigencia.sql',
      'agenda/sgh/0182_bloqueio.sql',
      'agenda/sgh/0183_marcacao_ext.sql',
      'agenda/sgh/0184_cancelamento.sql',
      'agenda/sgh/0185_lista_espera.sql',
      'agenda/sgh/0186_confirmacao.sql',
      'agenda/sgh/0187_geracao.sql',
    ]);
    const grants = doM17.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants.filter((g) => /DELETE/i.test(g))).toEqual([]);
    expect(
      grants
        .filter((g) => !/UPDATE/i.test(g))
        .map((g) => /ON (\w+)/.exec(g)?.[1])
        .sort(),
    ).toEqual([
      'SGH_AGE_BLOQUEIO_HORARIO',
      'SGH_AGE_CANCELAMENTO',
      'SGH_AGE_CONFIRMACAO',
      'SGH_AGE_GERACAO_HORARIO',
      'SGH_AGE_MARCACAO_EXT',
    ]);
  });

  it('M23: a supervisão da preceptoria muda só a situação', () => {
    const s = scripts.find((x) => x.numero === 227);
    expect(s?.arquivo).toBe('pep/sgh/0227_pep_supervisao.sql');
    expect(s?.comandos.filter((c) => /^GRANT UPDATE/.test(c))).toEqual([
      'GRANT UPDATE (SITUACAO, MOTIVO, COASSINADO_EM) ON SGH_PEP_SUPERVISAO TO ROLE SGH_APLICACAO',
    ]);
  });

  it('M23: a marca da vigia do parecer muda só a marca (UPDATE de ULTIMO_ID e ATUALIZADO_EM)', () => {
    const s = scripts.find((x) => x.numero === 226);
    expect(s?.arquivo).toBe('pep/sgh/0226_pep_vigia_marca.sql');
    expect(s?.comandos.filter((c) => /^GRANT /.test(c))).toEqual([
      'GRANT SELECT, INSERT ON SGH_PEP_VIGIA_MARCA TO ROLE SGH_APLICACAO',
      'GRANT UPDATE (ULTIMO_ID, ATUALIZADO_EM) ON SGH_PEP_VIGIA_MARCA TO ROLE SGH_APLICACAO',
    ]);
  });

  it('M18: extensão da marcação de exame e ligação, exceção e registro do ato só de inclusão; estado, pendência e cobertura com UPDATE (nunca DELETE)', () => {
    const doM18 = scripts.filter((x) => x.numero >= 188 && x.numero <= 189);
    expect(doM18.map((x) => x.arquivo)).toEqual([
      'agenda/sgh/0188_agenda_exame.sql',
      'cirurgia/sgh/0189_cirurgia.sql',
    ]);
    const grants = doM18.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c));
    expect(grants.filter((g) => /DELETE/i.test(g))).toEqual([]);
    expect(
      grants
        .filter((g) => !/UPDATE/i.test(g))
        .map((g) => /ON (\w+)/.exec(g)?.[1])
        .sort(),
    ).toEqual(['SGH_AGE_EXAME_PROCED', 'SGH_CC_EXCECAO', 'SGH_CC_LIGACAO', 'SGH_CC_REGISTRO_EXT']);
    for (const s of doM18) for (const c of s.comandos) expect(() => conferirComandoSgh(c)).not.toThrow();
    // Correção da revisão do M18: a ligação única por agendamento (só o índice SGH_, nada do legado).
    const unica = scripts.find((x) => x.numero === 199);
    expect(unica?.arquivo).toBe('cirurgia/sgh/0199_cirurgia_ligacao_unica.sql');
    expect(unica?.comandos).toEqual([
      'CREATE UNIQUE INDEX SGH_UQ_CC_LIGACAO_AGENDA ON SGH_CC_LIGACAO (HOSPITAL, ID_CCAGENDA)',
    ]);
    for (const c of unica?.comandos ?? []) expect(() => conferirComandoSgh(c)).not.toThrow();
  });

  it('M22: família, versão do registro, documento e eventos do documento (só inclusão, salvo a família)', () => {
    const doM22 = scripts.filter((x) => x.numero >= 220 && x.numero <= 225);
    expect(doM22.map((x) => x.arquivo)).toEqual([
      'pep/sgh/0220_pep_form_familia.sql',
      'pep/sgh/0221_pep_reg_versao.sql',
      'pep/sgh/0222_pep_doc.sql',
      'pep/sgh/0223_pep_doc_evento.sql',
      'pep/sgh/0224_pep_rascunho.sql',
      'pep/sgh/0225_pep_doc_evento_como.sql',
    ]);
    expect(doM22.flatMap((x) => x.comandos).filter((c) => /^GRANT SELECT/i.test(c))).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON SGH_PEP_FORM_FAMILIA TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_REG_VERSAO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_DOC TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_DOC_EVENTO TO ROLE SGH_APLICACAO',
      'GRANT SELECT, INSERT ON SGH_PEP_RASCUNHO TO ROLE SGH_APLICACAO',
    ]);
    // Corretor: a marca da sessão "como" no evento do documento, em coluna nova anulável.
    expect(scripts.find((x) => x.numero === 225)?.comandos).toEqual([
      'ALTER TABLE SGH_PEP_DOC_EVENTO ADD COMO_SUPORTE CHAR(1)',
    ]);
  });

  it('ADR 0022: o modo da sessão (como ou acesso total) em coluna nova anulável, com CHECK', () => {
    const s = scripts.find((x) => x.numero === 18);
    expect(s?.arquivo).toBe('suporte/sgh/0018_suporte_acesso_total.sql');
    expect(s?.comandos).toEqual([
      'ALTER TABLE SGH_SUP_SESSAO ADD MODO VARCHAR(12)',
      "ALTER TABLE SGH_SUP_SESSAO ADD CONSTRAINT SGH_CK_SUP_SESSAO_MODO CHECK (MODO IS NULL OR MODO IN ('como', 'acesso-total'))",
    ]);
  });

  it('ADR 0021: suporte técnico e login como (contas, atribuições, sessões, escritas, imagens e correções)', () => {
    const s = scripts.find((x) => x.numero === 17);
    expect(s?.arquivo).toBe('suporte/sgh/0017_suporte_login_como.sql');
    const criadas = (s?.comandos ?? []).flatMap((c) => /^CREATE TABLE (\w+)/.exec(c)?.[1] ?? []);
    expect(criadas).toEqual([
      'SGH_PLAT_CONTA',
      'SGH_PLAT_ATRIBUICAO',
      'SGH_PLAT_AUDITORIA',
      'SGH_SUP_SESSAO',
      'SGH_SUP_ACAO',
      'SGH_SUP_LEITURA',
      'SGH_SUP_IMAGEM',
      'SGH_SUP_CORRECAO',
    ]);
    // Imagens, correções e auditoria só de inclusão: o papel da aplicação nunca altera nem apaga.
    for (const t of ['SGH_PLAT_AUDITORIA', 'SGH_SUP_IMAGEM', 'SGH_SUP_CORRECAO'])
      expect(s?.comandos).toContain(`GRANT SELECT, INSERT ON ${t} TO ROLE SGH_APLICACAO`);
    expect((s?.comandos ?? []).some((c) => /^GRANT .*\bDELETE\b/.test(c))).toBe(false);
  });

  it('M08: parâmetro, pré-requisito, liberação expandida (recurso, grupo, lote) e o índice único do mapa', () => {
    const arquivos = scripts.filter((s) => s.numero >= 12 && s.numero <= 15).map((s) => s.arquivo);
    expect(arquivos).toEqual([
      'config/sgh/0012_cfg_parametro.sql',
      'config/sgh/0013_cfg_prerequisito.sql',
      'config/sgh/0014_cfg_liberacao_recurso.sql',
      'acesso/sgh/0015_mapa_opcao_unico.sql',
    ]);
    const lib = scripts.find((s) => s.numero === 14) as ScriptSgh;
    expect(lib.comandos.some((c) => c.includes("ESCOPO IN ('hospital', 'setor', 'grupo', 'pessoa')"))).toBe(
      true,
    );
    // O papel da aplicação inclui e altera, nunca exclui, as chaves.
    expect(lib.comandos.filter((c) => c.startsWith('GRANT') && /DELETE/.test(c))).toEqual([]);
    // 0016 (revisão): LIGADA nula = herda; uma só versão vigente por nível e alvo (índice único por expressão).
    const r = scripts.find((s) => s.numero === 16) as ScriptSgh;
    expect(r.arquivo).toBe('config/sgh/0016_cfg_herda_e_vigente_unica.sql');
    expect(r.comandos).toEqual([
      'ALTER TABLE SGH_CFG_LIBERACAO ALTER LIGADA DROP NOT NULL',
      expect.stringMatching(
        /^CREATE UNIQUE INDEX SGH_IDX_CFG_PARAM_VIGENTE ON SGH_CFG_PARAMETRO COMPUTED BY/,
      ),
    ]);
    const mapa = scripts.find((s) => s.numero === 15) as ScriptSgh;
    expect(mapa.comandos[0]).toMatch(
      /^CREATE UNIQUE INDEX SGH_IDX_ACESSO_MAPA_UNICO ON SGH_ACESSO_MAPA_OPCAO COMPUTED BY/,
    );
  });

  it('SGH_TRILHA: o papel da aplicação recebe só SELECT e INSERT (regra 9)', () => {
    const trilha = scripts.find((s) => s.numero === 4) as ScriptSgh;
    const grants = trilha.comandos.filter((c) => c.startsWith('GRANT'));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT ON SGH_TRILHA TO ROLE SGH_APLICACAO',
      'GRANT USAGE ON SEQUENCE SGH_GEN_TRILHA TO ROLE SGH_APLICACAO',
    ]);
    expect(trilha.comandos.join(' ')).not.toMatch(/\bTRIGGER\b|REFERENCES (?!SGH_)/);
  });

  it('nomes até 31 caracteres e sem FK para tabela legada', () => {
    for (const s of scripts) {
      for (const c of s.comandos) {
        for (const n of c.matchAll(/\b(SGH_[A-Z0-9_]+)/g))
          expect((n[1] as string).length).toBeLessThanOrEqual(31);
        for (const r of c.matchAll(/REFERENCES\s+(\w+)/g)) expect(r[1]).toMatch(/^SGH_/);
      }
    }
  });
});

describe('conferência de cada comando', () => {
  it('aceita CREATE/ALTER/DROP/COMMENT de objeto SGH_ e GRANT para o papel da aplicação', () => {
    for (const c of [
      'CREATE TABLE SGH_X (ID INTEGER)',
      'CREATE UNIQUE DESCENDING INDEX SGH_IDX_X ON SGH_X (ID)',
      'CREATE SEQUENCE SGH_GEN_X',
      'CREATE ROLE SGH_APLICACAO',
      'ALTER TABLE SGH_X ADD Y INTEGER',
      'DROP INDEX SGH_IDX_X',
      'COMMENT ON TABLE SGH_X IS',
      'GRANT SELECT ON SGH_X TO ROLE SGH_APLICACAO',
      'GRANT UPDATE (A, B) ON SGH_X TO ROLE SGH_APLICACAO',
      'REVOKE INSERT ON SGH_X FROM ROLE SGH_APLICACAO',
    ])
      expect(() => conferirComandoSgh(c), c).not.toThrow();
  });

  it('recusa objeto legado, trigger, FK legada, RECREATE, procedimento e privilégio amplo ou para outro', () => {
    for (const c of [
      'ALTER TABLE RICADPAC ADD X INTEGER',
      'CREATE INDEX SGH_IDX ON RICADPAC (NOME)',
      'CREATE TRIGGER SGH_T FOR SGH_X BEFORE INSERT AS BEGIN END',
      'CREATE TABLE SGH_X (ID INTEGER REFERENCES RICADPAC (ID))',
      'RECREATE TABLE SGH_X (ID INTEGER)',
      'CREATE PROCEDURE SGH_P AS BEGIN END',
      'GRANT SELECT ON RICADPAC TO ROLE SGH_APLICACAO',
      'GRANT SELECT ON SGH_X TO PUBLIC',
      'GRANT ALL ON SGH_X TO ROLE SGH_APLICACAO',
      'GRANT SGH_APLICACAO TO',
      'DELETE FROM SGH_X',
      `CREATE TABLE SGH_${'X'.repeat(30)} (ID INTEGER)`,
    ])
      expect(() => conferirComandoSgh(c), c).toThrow(ErroScriptSgh);
  });

  it('separa comandos sem comentários e lista os objetos criados', () => {
    const cmds = comandosDoScript(
      '-- c\nCREATE TABLE SGH_X (\n  ID INTEGER -- id\n);\nCREATE INDEX SGH_I ON SGH_X (ID);\n',
    );
    expect(cmds).toEqual(['CREATE TABLE SGH_X ( ID INTEGER )', 'CREATE INDEX SGH_I ON SGH_X (ID)']);
    expect(objetosCriados({ comandos: cmds })).toEqual(['SGH_X', 'SGH_I']);
  });

  it('pasta fora do padrão, número repetido, sem 0001 ou script vazio: recusa', () => {
    const p = (nome: string) => {
      const d = mkdtempSync(join(tmp, nome));
      return d;
    };
    const rep = p('rep');
    mkdirSync(join(rep, 'a', 'sgh'), { recursive: true });
    mkdirSync(join(rep, 'b', 'sgh'), { recursive: true });
    writeFileSync(join(rep, 'a', 'sgh', '0001_x.sql'), 'CREATE TABLE SGH_A (ID INTEGER);');
    writeFileSync(join(rep, 'b', 'sgh', '0001_y.sql'), 'CREATE TABLE SGH_B (ID INTEGER);');
    writeFileSync(join(rep, 'arquivo-solto'), '');
    expect(() => lerScriptsSgh(rep)).toThrow(/repetido/);
    const sem1 = p('sem1');
    mkdirSync(join(sem1, 'a', 'sgh'), { recursive: true });
    writeFileSync(join(sem1, 'a', 'sgh', '0002_x.sql'), 'CREATE TABLE SGH_A (ID INTEGER);');
    expect(() => lerScriptsSgh(sem1)).toThrow(/0001/);
    const vazio = p('vazio');
    mkdirSync(join(vazio, 'a', 'sgh'), { recursive: true });
    writeFileSync(join(vazio, 'a', 'sgh', '0001_x.sql'), '-- nada\n');
    expect(() => lerScriptsSgh(vazio)).toThrow(/sem comandos/);
    const nome = p('nome');
    mkdirSync(join(nome, 'a', 'sgh'), { recursive: true });
    writeFileSync(join(nome, 'a', 'sgh', 'x.sql'), 'CREATE TABLE SGH_A (ID INTEGER);');
    expect(() => lerScriptsSgh(nome)).toThrow(/fora do padrão/);
  });
});

const script = (numero: number, comandos: string[]): ScriptSgh => ({
  numero,
  arquivo: `g/sgh/${String(numero).padStart(4, '0')}_x.sql`,
  grupo: 'g',
  descricao: 'x',
  hash: hashScript(comandos.join(';')),
  comandos,
});

describe('plano', () => {
  const s1 = script(1, ['CREATE TABLE SGH_VERSAO_SCRIPT (N INTEGER)']);
  const s2 = script(2, ['CREATE TABLE SGH_B (ID INTEGER)']);
  it('aplica o que falta, recusa hash diferente e registro sem arquivo', () => {
    expect(planejarScripts([s1, s2], []).pendentes).toEqual([s1, s2]);
    expect(planejarScripts([s1, s2], [{ numero: 1, hash: s1.hash }]).pendentes).toEqual([s2]);
    expect(() => planejarScripts([s1, s2], [{ numero: 1, hash: 'outro' }])).toThrow(/hash diferente/);
    expect(() =>
      planejarScripts(
        [s1],
        [
          { numero: 1, hash: s1.hash },
          { numero: 9, hash: 'x' },
        ],
      ),
    ).toThrow(/sem o arquivo/);
  });
  it('M11: em dev, o registro de outro ramo (cópia compartilhada) é aceito; o hash dos conhecidos continua', () => {
    const registros = [
      { numero: 1, hash: s1.hash },
      { numero: 120, hash: 'de-outro-ramo' },
    ];
    expect(planejarScripts([s1, s2], registros, true).pendentes).toEqual([s2]);
    expect(() => planejarScripts([s1, s2], [{ numero: 1, hash: 'outro' }], true)).toThrow(/hash diferente/);
  });
});

/** Banco dublê: tabela de versões, objetos existentes, transações confirmadas. */
function bancoScripts(registrados: { numero: number; hash: string }[] = [], existentes: string[] = []) {
  const executados: string[] = [];
  let confirmadas = 0;
  const e = escritorDuble((c) => {
    if (c.sql.includes('RDB$ROLES')) return [{ N: existentes.includes(String(c.parametros[0])) ? 1 : 0 }];
    if (c.sql.includes('FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?'))
      return [{ N: registrados.length > 0 ? 1 : 0 }];
    if (c.sql.includes('FROM SGH_VERSAO_SCRIPT'))
      return registrados.map((r) => ({ NUMERO: r.numero, HASH_SHA256: r.hash }));
    if (c.tipo === 'executar') executados.push(c.sql);
    return 1;
  });
  const acesso: AcessoScripts = {
    ler: <T>(fn: (l: Leitor) => Promise<T>) => fn(e),
    escreverConfirmando: async <T>(fn: (w: Escritor) => Promise<T>) => {
      const r = await fn(e);
      confirmadas++;
      return r;
    },
  };
  return { acesso, executados, confirmadas: () => confirmadas, comandos: e.comandos };
}

describe('aplicação', () => {
  const s1 = script(1, ['CREATE ROLE SGH_APLICACAO', 'CREATE TABLE SGH_VERSAO_SCRIPT (N INTEGER)']);
  const s2 = script(2, ['CREATE TABLE SGH_B (ID INTEGER)', 'GRANT SELECT ON SGH_B TO ROLE SGH_APLICACAO']);

  it('do zero: aplica em ordem e registra com o hash e o ambiente (o 0001 à parte; os demais na transação do DDL, M60)', async () => {
    const b = bancoScripts();
    const vistos: number[] = [];
    const r = await aplicarScripts(b.acesso, [s1, s2], {
      ambiente: 'dev',
      aoAplicar: (s) => vistos.push(s.numero),
    });
    expect(r).toMatchObject({ jaAplicados: 0, papelConcedidoA: null });
    expect(vistos).toEqual([1, 2]);
    expect(b.executados.filter((x) => x.startsWith('INSERT INTO SGH_VERSAO_SCRIPT'))).toHaveLength(2);
    expect(b.confirmadas()).toBe(3);
    const reg = b.comandos.find((c) => c.sql.startsWith('INSERT INTO SGH_VERSAO_SCRIPT'));
    expect(reg?.parametros).toEqual([1, s1.arquivo, 'x', s1.hash, 'dev']);
  });

  it('de novo: nada aplicado (idempotente); concede o papel à conta da aplicação (nunca a SYSDBA)', async () => {
    const b = bancoScripts([
      { numero: 1, hash: s1.hash },
      { numero: 2, hash: s2.hash },
    ]);
    const r = await aplicarScripts(b.acesso, [s1, s2], { ambiente: 'dev', contaAplicacao: 'sgh_app' });
    expect(r).toMatchObject({ aplicados: [], jaAplicados: 2, papelConcedidoA: 'SGH_APP' });
    expect(b.executados).toEqual(['GRANT SGH_APLICACAO TO USER SGH_APP']);
    const sysdba = bancoScripts([{ numero: 1, hash: s1.hash }]);
    expect(
      (await aplicarScripts(sysdba.acesso, [s1], { ambiente: 'dev', contaAplicacao: 'SYSDBA' }))
        .papelConcedidoA,
    ).toBeNull();
    await expect(
      aplicarScripts(sysdba.acesso, [s1], { ambiente: 'dev', contaAplicacao: 'x; DROP' }),
    ).rejects.toThrow(/inválido/);
  });

  it('regra 11: produção sem autorização registrada é recusada antes do banco', async () => {
    const b = bancoScripts();
    await expect(aplicarScripts(b.acesso, [s1], { ambiente: 'producao' })).rejects.toThrow(
      /Produção recusada/,
    );
    expect(b.comandos).toHaveLength(0);
    await expect(
      aplicarScripts(b.acesso, [s1], {
        ambiente: 'producao',
        autorizacao: '| 2026-11-01 | sgh:aplicar producao pc |',
      }),
    ).resolves.toBeTruthy();
    await expect(aplicarScripts(b.acesso, [s1], { ambiente: 'qualquer' as never })).rejects.toThrow(
      /inválido/,
    );
  });

  it('objeto já existente sem registro (aplicação interrompida): recusa sem tocar no banco', async () => {
    const b = bancoScripts([], ['SGH_APLICACAO']);
    await expect(aplicarScripts(b.acesso, [s1], { ambiente: 'dev' })).rejects.toThrow(
      /já existem sem registro/,
    );
    expect(b.executados).toHaveLength(0);
  });

  it('registro que não grava 1 linha: erro', async () => {
    const b = bancoScripts();
    const acesso: AcessoScripts = {
      ...b.acesso,
      escreverConfirmando: async <T>(fn: (w: Escritor) => Promise<T>) =>
        fn(escritorDuble((c) => (c.sql.startsWith('INSERT INTO SGH_VERSAO_SCRIPT') ? 0 : 1))),
    };
    await expect(aplicarScripts(acesso, [s1], { ambiente: 'dev' })).rejects.toThrow(/registro não gravado/);
  });
});
