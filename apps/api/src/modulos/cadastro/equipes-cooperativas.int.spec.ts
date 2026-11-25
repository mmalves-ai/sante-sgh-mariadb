// Contrato de efeito das equipes médicas e cooperativas do profissional (F8, 02-CAD linha 22) contra o MariaDB real, no
// cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real; CNPJ gerado para
// teste). Prova o que fica no banco: a equipe em `equipe_profissional` (código normalizado, o repetido recusado), os
// membros em `equipe_profissional_membro` (o responsável vigente vai também à equipe; sobreposição, segundo responsável e
// vigência fora da equipe recusados), o fim da equipe recusado com membro aberto, o encerramento do membro (fim gravado,
// linha mantida; encerrar para depois recusado), a cooperativa em `cooperativa_medica` sobre a pessoa jurídica do CNPJ
// (CNPJ repetido e conta pela metade recusados; alteração sobe a versão), o cooperado em `membro_cooperativa` com a
// sobreposição recusada e o encerramento, a visão por profissional e a trilha de cada gravação. SGH_NUCLEO_SEM_BANCO=1
// pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EntradaCooperativaTela,
  type EntradaEquipeTela,
  EquipesCooperativasPropria,
} from './equipes-cooperativas-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f8-02-22-equipes';
const COD = `${MARCA}-EQ`;

/** CNPJ sintético com dígitos verificadores válidos a partir de 12 dígitos. */
function cnpjSintetico(base12: string): string {
  const dv = (b: string) => {
    const pesos =
      b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = [...b].reduce((a, c, i) => a + Number(c) * pesos[i]!, 0) % 11;
    return s < 2 ? '0' : String(11 - s);
  };
  const d1 = dv(base12);
  return `${base12}${d1}${dv(base12 + d1)}`;
}
const CNPJ = cnpjSintetico('990102220001');

describe.skipIf(SEM_BANCO)('equipes médicas e cooperativas no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: EquipesCooperativasPropria;
  let m: Massa | null = null;
  let equipe = 0;
  let responsavel = 0;
  let cooperativa = 0;
  let cooperado = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const t = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.profissional' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const eq = (p: Partial<EntradaEquipeTela> = {}): EntradaEquipeTela => ({
    id: null,
    versao: null,
    codigo: ` ${COD.toLowerCase()} `,
    nome: `${MARCA} EQUIPE CARDIO`,
    tipo: 'medica',
    setorId: null,
    inicio: '2026-01-01',
    fim: null,
    ativo: true,
    ...p,
  });
  const coop = (p: Partial<EntradaCooperativaTela> = {}): EntradaCooperativaTela => ({
    id: null,
    versao: null,
    cnpj: CNPJ,
    razaoSocial: `${MARCA} COOPERATIVA SINTETICA`,
    nome: `${MARCA} COOP`,
    percentualRepasse: 80,
    bancoId: null,
    agencia: null,
    agenciaDigito: null,
    conta: null,
    contaDigito: null,
    tipoConta: null,
    retemIr: true,
    aliquotaIr: 1.5,
    aliquotaIss: 5,
    aliquotaPis: null,
    aliquotaCofins: null,
    aliquotaCsll: null,
    optanteSimples: false,
    ativo: true,
    ...p,
  });
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return (e as { problema?: { codigo?: string } }).problema?.codigo ?? String(e);
    }
  };
  const membro = (prof: number, papel: string, inicio: string, fim: string | null = null) =>
    s.incluirMembro(
      c(),
      { equipeId: equipe, profissionalId: prof, papel, inicio, fim },
      t('equipe_profissional_membro'),
    );

  async function limparMinhas(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const eqs = 'SELECT id FROM equipe_profissional WHERE codigo LIKE ?';
      await e.executar(
        `DELETE FROM equipe_profissional_membro WHERE equipe_profissional_id IN (SELECT id FROM (${eqs}) x)`,
        [`${MARCA}%`],
      );
      await e.executar('DELETE FROM equipe_profissional WHERE codigo LIKE ?', [`${MARCA}%`]);
      const cps =
        'SELECT c.id FROM cooperativa_medica c JOIN pessoa_juridica pj ON pj.id = c.pessoa_juridica_id WHERE pj.cnpj = ?';
      await e.executar(
        `DELETE FROM membro_cooperativa WHERE cooperativa_medica_id IN (SELECT id FROM (${cps}) x)`,
        [CNPJ],
      );
      await e.executar(`DELETE FROM cooperativa_medica WHERE id IN (SELECT id FROM (${cps}) x)`, [CNPJ]);
      await e.executar('DELETE FROM pessoa_juridica WHERE cnpj = ?', [CNPJ]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new EquipesCooperativasPropria(nucleo, CLIENTE_F22, undefined, () => '2026-06-15');
  }, 120_000);

  afterAll(async () => {
    // A trilha do estabelecimento sintético é comum aos contratos do lote 01-02 (limparMassa cuida dela).
    if (m) await limparMinhas();
    await nucleo?.encerrar?.();
  });

  it('cria a equipe com o código normalizado e recusa o código repetido', async () => {
    equipe = await s.salvarEquipe(c(), eq(), t('equipe_profissional'));
    expect(
      await um('SELECT codigo, tipo, estabelecimento_id, versao FROM equipe_profissional WHERE id = ?', [
        equipe,
      ]),
    ).toMatchObject({ codigo: COD, tipo: 'medica', estabelecimento_id: m!.estabelecimento, versao: 1 });
    expect(await codigo(s.salvarEquipe(c(), eq({ nome: `${MARCA} OUTRA` }), t('equipe_profissional')))).toBe(
      'codigo-repetido',
    );
    expect(
      await codigo(s.salvarEquipe(c(), eq({ codigo: `${COD}-2`, tipo: 'x' }), t('equipe_profissional'))),
    ).toBe('tipo-invalido');
  });

  it('inclui membros: o responsável vai à equipe; sobreposição, segundo responsável e fora da vigência recusados', async () => {
    responsavel = await membro(m!.profissional, 'responsavel', '2026-01-01');
    expect(
      await um('SELECT responsavel_profissional_id AS r, versao FROM equipe_profissional WHERE id = ?', [
        equipe,
      ]),
    ).toMatchObject({ r: m!.profissional, versao: 2 });
    await membro(m!.enfermeira, 'enfermeiro', '2026-02-01', '2026-03-31');
    expect(await codigo(membro(m!.enfermeira, 'enfermeiro', '2026-03-01'))).toBe('vigencia-sobreposta');
    expect(await codigo(membro(m!.enfermeira, 'responsavel', '2026-04-01'))).toBe('responsavel-duplicado');
    expect(await codigo(membro(m!.enfermeira, 'enfermeiro', '2025-12-01', '2025-12-31'))).toBe(
      'fora-da-vigencia-equipe',
    );
    // Depois do fim do período anterior, o mesmo profissional volta num novo período (o anterior fica).
    await membro(m!.enfermeira, 'enfermeiro', '2026-04-01');
    const n = await um<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM equipe_profissional_membro WHERE equipe_profissional_id = ?',
      [equipe],
    );
    expect(Number(n!.n)).toBe(3);
  });

  it('o fim da equipe com membro aberto é recusado; o membro se encerra sem apagar', async () => {
    const v = Number(
      (await um<{ v: unknown }>('SELECT versao AS v FROM equipe_profissional WHERE id = ?', [equipe]))!.v,
    );
    expect(
      await codigo(
        s.salvarEquipe(c(), eq({ id: equipe, versao: v, fim: '2026-12-31' }), t('equipe_profissional')),
      ),
    ).toBe('membros-apos-fim-equipe');
    const vm = Number(
      (await um<{ v: unknown }>('SELECT versao AS v FROM equipe_profissional_membro WHERE id = ?', [
        responsavel,
      ]))!.v,
    );
    await s.encerrarMembro(
      c(),
      { id: responsavel, versao: vm, fim: '2026-05-31' },
      t('equipe_profissional_membro'),
    );
    expect(
      await um(
        "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao, excluido_em FROM equipe_profissional_membro WHERE id = ?",
        [responsavel],
      ),
    ).toMatchObject({ fim: '2026-05-31', versao: vm + 1, excluido_em: null });
    // O responsável saiu antes de hoje (15/06): a equipe fica sem responsável.
    expect(
      await um('SELECT responsavel_profissional_id AS r FROM equipe_profissional WHERE id = ?', [equipe]),
    ).toMatchObject({ r: null });
    expect(
      await codigo(
        s.encerrarMembro(
          c(),
          { id: responsavel, versao: vm + 1, fim: '2026-06-30' },
          t('equipe_profissional_membro'),
        ),
      ),
    ).toBe('encerramento-nao-antecipa');
  });

  it('cria a cooperativa sobre a pessoa jurídica do CNPJ; repetida e conta pela metade recusadas; altera com versão', async () => {
    cooperativa = await s.salvarCooperativa(c(), coop(), t('cooperativa_medica'));
    expect(
      await um(
        `SELECT pj.cnpj, c.percentual_repasse + 0 AS pct, c.retem_ir, c.versao FROM cooperativa_medica c
           JOIN pessoa_juridica pj ON pj.id = c.pessoa_juridica_id WHERE c.id = ?`,
        [cooperativa],
      ),
    ).toMatchObject({ cnpj: CNPJ, versao: 1 });
    expect(await codigo(s.salvarCooperativa(c(), coop(), t('cooperativa_medica')))).toBe(
      'cooperativa-repetida',
    );
    expect(
      await codigo(
        s.salvarCooperativa(
          c(),
          coop({ id: cooperativa, versao: 1, agencia: '0001' }),
          t('cooperativa_medica'),
        ),
      ),
    ).toBe('conta-incompleta');
    expect(
      await codigo(s.salvarCooperativa(c(), coop({ cnpj: '11222333000182' }), t('cooperativa_medica'))),
    ).toBe('cnpj-invalido');
    await s.salvarCooperativa(
      c(),
      coop({ id: cooperativa, versao: 1, percentualRepasse: 75 }),
      t('cooperativa_medica'),
    );
    const x = await um<{ pct: unknown; versao: unknown }>(
      'SELECT percentual_repasse AS pct, versao FROM cooperativa_medica WHERE id = ?',
      [cooperativa],
    );
    expect([Number(x!.pct), Number(x!.versao)]).toEqual([75, 2]);
    // A razão social digitada na alteração vai à pessoa jurídica do CNPJ, com versão, e a visão a mostra.
    const pj0 = await um<{ v: unknown }>('SELECT versao AS v FROM pessoa_juridica WHERE cnpj = ?', [CNPJ]);
    await s.salvarCooperativa(
      c(),
      coop({
        id: cooperativa,
        versao: 2,
        percentualRepasse: 75,
        razaoSocial: `  ${MARCA}  COOP   NOVA RAZAO `,
      }),
      t('cooperativa_medica'),
    );
    expect(
      await um<{ r: unknown; v: unknown }>(
        'SELECT razao_social AS r, versao AS v FROM pessoa_juridica WHERE cnpj = ?',
        [CNPJ],
      ),
    ).toMatchObject({ r: `${MARCA} COOP NOVA RAZAO`, v: Number(pj0!.v) + 1 });
    expect((await s.visao(c(), null)).cooperativas.find((x) => x.id === cooperativa)?.razaoSocial).toBe(
      `${MARCA} COOP NOVA RAZAO`,
    );
  });

  it('inclui e encerra o cooperado; sobreposição recusada; a visão por profissional mostra os vínculos', async () => {
    cooperado = await s.incluirCooperado(
      c(),
      { cooperativaId: cooperativa, profissionalId: m!.profissional, inicio: '2026-01-01', fim: null },
      t('membro_cooperativa'),
    );
    expect(
      await codigo(
        s.incluirCooperado(
          c(),
          { cooperativaId: cooperativa, profissionalId: m!.profissional, inicio: '2026-03-01', fim: null },
          t('membro_cooperativa'),
        ),
      ),
    ).toBe('vigencia-sobreposta');
    await s.encerrarCooperado(c(), { id: cooperado, versao: 1, fim: '2026-12-31' }, t('membro_cooperativa'));
    expect(
      await um(
        "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM membro_cooperativa WHERE id = ?",
        [cooperado],
      ),
    ).toMatchObject({ fim: '2026-12-31', versao: 2 });
    const v = await s.visao(c(), m!.profissional);
    expect(v.profissional?.id).toBe(m!.profissional);
    const minha = v.equipes.find((x) => x.id === equipe);
    expect(minha?.membros.map((x) => [x.papel, x.vigente])).toEqual(
      expect.arrayContaining([
        ['enfermeiro', true],
        ['responsavel', false],
      ]),
    );
    expect(v.cooperativas.find((x) => x.id === cooperativa)?.cooperados).toEqual([
      expect.objectContaining({ profissionalId: m!.profissional, fim: '2026-12-31', vigente: true }),
    ]);
  });

  it('o responsável vale pela data: início futuro passa a valer quando chega e o fim futuro mantém até o fim', async () => {
    const eq2 = await s.salvarEquipe(c(), eq({ codigo: `${COD}-R` }), t('equipe_profissional'));
    const em = (hoje: string) => new EquipesCooperativasPropria(nucleo, CLIENTE_F22, undefined, () => hoje);
    const resp = async (hoje: string) =>
      (await em(hoje).visao(c(), null)).equipes.find((x) => x.id === eq2)?.responsavelId ?? null;
    const coluna = async () =>
      (await um<{ r: unknown }>(
        'SELECT responsavel_profissional_id AS r FROM equipe_profissional WHERE id = ?',
        [eq2],
      ))!.r;
    // Hoje é 15/06: o responsável com início em 01/07 ainda não vale (nem na cópia da equipe, nem na visão).
    const r = await s.incluirMembro(
      c(),
      {
        equipeId: eq2,
        profissionalId: m!.profissional,
        papel: 'responsavel',
        inicio: '2026-07-01',
        fim: null,
      },
      t('equipe_profissional_membro'),
    );
    expect(await coluna()).toBeNull();
    expect(await resp('2026-06-15')).toBeNull();
    // Quando a data chega, a visão já mostra o responsável, sem gravação no dia.
    expect(await resp('2026-07-01')).toBe(m!.profissional);
    // Em 02/07, encerrado com fim em 10/07 (futuro): continua responsável até 10/07; a cópia é recalculada.
    const vm = Number(
      (await um<{ v: unknown }>('SELECT versao AS v FROM equipe_profissional_membro WHERE id = ?', [r]))!.v,
    );
    await em('2026-07-02').encerrarMembro(
      c(),
      { id: r, versao: vm, fim: '2026-07-10' },
      t('equipe_profissional_membro'),
    );
    expect(await coluna()).toBe(m!.profissional);
    expect(await resp('2026-07-10')).toBe(m!.profissional);
    expect(await resp('2026-07-11')).toBeNull();
    // Em 11/07, qualquer gravação dos membros recalcula a cópia: a equipe fica sem responsável.
    await em('2026-07-11').incluirMembro(
      c(),
      { equipeId: eq2, profissionalId: m!.enfermeira, papel: 'enfermeiro', inicio: '2026-07-11', fim: null },
      t('equipe_profissional_membro'),
    );
    expect(await coluna()).toBeNull();
  });

  it('o responsável informado na equipe sem período (importação) não é sobrescrito sem conferência', async () => {
    const eq3 = await s.salvarEquipe(c(), eq({ codigo: `${COD}-L` }), t('equipe_profissional'));
    // Massa sintética: a equipe chega com o responsável preenchido e sem linha de membro, como na importação.
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar('UPDATE equipe_profissional SET responsavel_profissional_id = ? WHERE id = ?', [
        m!.profissional,
        eq3,
      ]),
    );
    expect((await s.visao(c(), null)).equipes.find((x) => x.id === eq3)?.responsavelId).toBe(m!.profissional);
    const membro3 = (prof: number, inicio: string, fim: string | null = null) =>
      s.incluirMembro(
        c(),
        { equipeId: eq3, profissionalId: prof, papel: 'responsavel', inicio, fim },
        t('equipe_profissional_membro'),
      );
    expect(await codigo(membro3(m!.enfermeira, '2026-07-01'))).toBe('responsavel-sem-vinculo');
    expect(
      await um('SELECT responsavel_profissional_id AS r FROM equipe_profissional WHERE id = ?', [eq3]),
    ).toMatchObject({ r: m!.profissional });
    // Registrado o atual com o período até 30/06, o novo assume em 01/07 (hoje 15/06: o atual segue).
    await membro3(m!.profissional, '2026-01-01', '2026-06-30');
    await membro3(m!.enfermeira, '2026-07-01');
    expect(
      await um('SELECT responsavel_profissional_id AS r FROM equipe_profissional WHERE id = ?', [eq3]),
    ).toMatchObject({ r: m!.profissional });
    const v = await new EquipesCooperativasPropria(nucleo, CLIENTE_F22, undefined, () => '2026-07-01').visao(
      c(),
      null,
    );
    expect(v.equipes.find((x) => x.id === eq3)?.responsavelId).toBe(m!.enfermeira);
  });

  it('cada gravação deixa a trilha', async () => {
    const tr = await um<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND
         ((entidade = 'equipe_profissional' AND entidade_id = ?) OR (entidade = 'cooperativa_medica' AND entidade_id = ?)
          OR (entidade = 'membro_cooperativa' AND entidade_id = ?))`,
      [m!.estabelecimento, equipe, cooperativa, cooperado],
    );
    expect(Number(tr!.n)).toBeGreaterThanOrEqual(5);
  });
});
