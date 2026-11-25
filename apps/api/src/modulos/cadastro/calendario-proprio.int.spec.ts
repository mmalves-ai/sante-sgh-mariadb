// Contrato de efeito do calendário de feriados e dias não úteis (F3.1, 02-CAD linha 28) contra o MariaDB real, no
// cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica
// no banco: inclusão em `dia_nao_util` (cadastro único) com a trilha; dia repetido no mesmo alvo recusado (no outro
// estabelecimento, aceito); faixas do dia que não se cruzam convivem; alteração com a versão lida (versão velha, 409);
// inativar exige motivo e não apaga (a linha fica, inativa, e sai do que a agenda pula); reativar volta; as datas móveis
// saem uma por ano e gerar de novo não duplica; e o leitor comum da agenda de consultas e de exames passa a pular o dia.
// O dia de outro estabelecimento só se mantém na sessão dele (incluir, alterar e inativar recusados de fora; a visão não
// o lista). A migração 05_AGE/91 retira a tabela anterior ao cadastro único (DROP TABLE IF EXISTS: idempotente), e
// o dia de data única do Calendário vale na agenda e sai dela quando inativado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { readFileSync } from 'node:fs';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerDiasSemExpediente } from '../agenda/dias-sem-expediente-leitor.js';
import { CalendarioProprio, type EntradaCalendario } from './calendario-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-6-calendario';
const ANO = 2041;
const DESC = `${MARCA} CAL`;

describe.skipIf(SEM_BANCO)('calendário de dias não úteis no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: CalendarioProprio;
  let m: Massa | null = null;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const t = (): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade: 'dia_nao_util',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.calendario' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  // A sessão do outro estabelecimento (quem troca de estabelecimento entra na sessão dele).
  const c2 = () => ({ ...contextoPorta(m!, COR), estabelecimento: m!.outroEstabelecimento });
  const t2 = (): RegistroTrilhaTela => ({ ...t(), estabelecimento: m!.outroEstabelecimento });
  const entrada = (p: Partial<EntradaCalendario>): EntradaCalendario => ({
    descricao: `${DESC} DIA`,
    abrangencia: 'estabelecimento',
    ufId: null,
    municipio: null,
    estabelecimento: m!.estabelecimento,
    recorrencia: 'data_unica',
    dia: null,
    mes: null,
    data: `${ANO}-08-10`,
    facultativo: false,
    horaInicio: null,
    horaFim: null,
    ...p,
  });
  const linha = (id: number) =>
    um<Record<string, unknown>>(
      'SELECT ativo, versao, data, hora_inicio, recorrencia, abrangencia, estabelecimento_id FROM dia_nao_util WHERE id = ?',
      [id],
    );
  const pulados = () =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) =>
      lerDiasSemExpediente(l, m!.estabelecimento, `${ANO}-01-01`, `${ANO}-12-31`),
    );
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return (e as { problema?: { codigo?: string } }).problema?.codigo ?? String(e);
    }
  };

  async function limparMinhas(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar('DELETE FROM dia_nao_util WHERE descricao LIKE ?', [`${DESC}%`]).then(() => undefined),
    );
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new CalendarioProprio(nucleo, CLIENTE_F22);
  }, 120_000);

  afterAll(async () => {
    if (m) await limparMinhas();
    await nucleo?.encerrar?.();
  });

  it('inclui o dia do estabelecimento, com a trilha, e a agenda passa a pular o dia', async () => {
    const id = await s.incluir(c(), entrada({}), t());
    expect(await linha(id)).toMatchObject({ ativo: 1, versao: 1, recorrencia: 'data_unica' });
    const tr = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'dia_nao_util' AND entidade_id = ?",
      [id],
    );
    expect(Number(tr!.n)).toBeGreaterThanOrEqual(1);
    expect((await pulados()).filter((f) => f.data === `${ANO}-08-10`)).toEqual([
      expect.objectContaining({ data: `${ANO}-08-10`, nome: `${DESC} DIA` }),
    ]);
    const v = await s.visao(c(), ANO);
    expect(v.itens.find((x) => x.id === id)).toMatchObject({ valeAqui: true, datasNoAno: [`${ANO}-08-10`] });
  });

  it('recusa o mesmo dia no mesmo alvo; no outro estabelecimento, só na sessão dele; faixas que não se cruzam convivem', async () => {
    expect(await codigo(s.incluir(c(), entrada({ descricao: `${DESC} DUP` }), t()))).toBe(
      'dia-ja-cadastrado',
    );
    const doOutro = entrada({ descricao: `${DESC} OUTRO`, estabelecimento: m!.outroEstabelecimento });
    expect(await codigo(s.incluir(c(), doOutro, t()))).toBe('estabelecimento-fora-da-sessao');
    const outro = await s.incluir(c2(), doOutro, t2());
    expect(await linha(outro)).toMatchObject({ estabelecimento_id: m!.outroEstabelecimento });
    // De fora da sessão dele, o dia do outro estabelecimento não se altera, não se inativa e não aparece na visão.
    expect(await codigo(s.alterar(c(), outro, 1, { ...doOutro, data: `${ANO}-08-12` }, t()))).toBe(
      'estabelecimento-fora-da-sessao',
    );
    expect(
      await codigo(s.situacao(c(), { id: outro, versao: 1, ativo: false, motivo: 'Fechar de fora' }, t())),
    ).toBe('estabelecimento-fora-da-sessao');
    expect(await linha(outro)).toMatchObject({ ativo: 1, versao: 1 });
    expect((await s.visao(c(), ANO)).itens.some((x) => x.id === outro)).toBe(false);
    expect((await s.visao(c2(), ANO)).itens.some((x) => x.id === outro)).toBe(true);
    const manha = await s.incluir(
      c(),
      entrada({ descricao: `${DESC} MANHA`, data: `${ANO}-08-11`, horaInicio: '08:00', horaFim: '12:00' }),
      t(),
    );
    const tarde = await s.incluir(
      c(),
      entrada({ descricao: `${DESC} TARDE`, data: `${ANO}-08-11`, horaInicio: '13:00', horaFim: '18:00' }),
      t(),
    );
    expect(manha).not.toBe(tarde);
    expect(
      await codigo(
        s.incluir(
          c(),
          entrada({
            descricao: `${DESC} CRUZA`,
            data: `${ANO}-08-11`,
            horaInicio: '11:00',
            horaFim: '14:00',
          }),
          t(),
        ),
      ),
    ).toBe('dia-ja-cadastrado');
    // Meio expediente: o dia não some da agenda inteiro; sai só a faixa.
    const f = (await pulados()).filter((x) => x.data === `${ANO}-08-11`);
    expect(f.map((x) => x.horaInicio).sort()).toEqual(['08:00', '13:00']);
    expect(await codigo(s.incluir(c(), entrada({ descricao: 'x', data: `${ANO}-02-30` }), t()))).toBe(
      'descricao-curta',
    );
  });

  it('altera com a versão lida; versão velha é recusada', async () => {
    const id = await s.incluir(
      c(),
      entrada({ descricao: `${DESC} ANUAL`, recorrencia: 'anual', data: null, dia: 3, mes: 9 }),
      t(),
    );
    await s.alterar(
      c(),
      id,
      1,
      entrada({ descricao: `${DESC} ANUAL`, recorrencia: 'anual', data: null, dia: 4, mes: 9 }),
      t(),
    );
    expect(await linha(id)).toMatchObject({ versao: 2 });
    expect(
      await codigo(
        s.alterar(
          c(),
          id,
          1,
          entrada({ descricao: `${DESC} ANUAL`, recorrencia: 'anual', data: null, dia: 5, mes: 9 }),
          t(),
        ),
      ),
    ).toBe('conflito-versao');
    expect((await pulados()).some((x) => x.data === `${ANO}-09-04`)).toBe(true);
  });

  it('inativar exige motivo e não apaga; reativar volta', async () => {
    const id = await s.incluir(c(), entrada({ descricao: `${DESC} INATIVA`, data: `${ANO}-10-20` }), t());
    expect(await codigo(s.situacao(c(), { id, versao: 1, ativo: false, motivo: '' }, t()))).toBe(
      'motivo-curto',
    );
    await s.situacao(c(), { id, versao: 1, ativo: false, motivo: 'Cadastrado por engano' }, t());
    expect(await linha(id)).toMatchObject({ ativo: 0, versao: 2 });
    expect((await pulados()).some((x) => x.data === `${ANO}-10-20`)).toBe(false);
    const v = await s.visao(c(), ANO);
    expect(v.itens.find((x) => x.id === id)).toMatchObject({ ativo: false });
    await s.situacao(c(), { id, versao: 2, ativo: true, motivo: '' }, t());
    expect(await linha(id)).toMatchObject({ ativo: 1, versao: 3 });
  });

  it('gera as datas móveis uma por ano e não duplica ao gerar de novo', async () => {
    const base = {
      base: 'corpus_christi' as const,
      anoInicio: ANO,
      anoFim: ANO + 1,
      descricao: `${DESC} CORPUS`,
      abrangencia: 'estabelecimento' as const,
      ufId: null,
      municipio: null,
      estabelecimento: m!.estabelecimento,
      facultativo: false,
    };
    const r1 = await s.gerarMoveis(c(), base, t());
    expect(r1).toMatchObject({ pulados: 0 });
    expect(r1.incluidos).toHaveLength(2);
    expect(await linha(r1.incluidos[0]!)).toMatchObject({ recorrencia: 'movel' });
    const r2 = await s.gerarMoveis(c(), base, t());
    expect(r2).toEqual({ incluidos: [], pulados: 2 });
    // Corpus Christi de 2041: Páscoa em 21/04, mais 60 dias.
    expect((await pulados()).some((x) => x.data === `${ANO}-06-20`)).toBe(true);
  });

  it('migração 05_AGE/91: a tabela anterior saiu do banco; o Calendário é o cadastro único que a agenda lê', async () => {
    const sql = readFileSync(
      new URL('../../../../../db/migracoes/05_AGE/91_retirar_feriado_chaves.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/^DROP TABLE IF EXISTS feriado;$/m);
    expect(
      await um<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'feriado'",
        [],
      ),
    ).toMatchObject({ n: 0 });
    // Um dia de data única do Calendário vale na agenda; inativado, sai (a linha fica).
    const id = await s.incluir(c(), entrada({ descricao: `${DESC} UNICO`, data: `${ANO}-07-07` }), t());
    expect((await pulados()).some((x) => x.data === `${ANO}-07-07`)).toBe(true);
    const l = await linha(id);
    await s.situacao(c(), { id, versao: Number(l!['versao']), ativo: false, motivo: 'Não vale mais' }, t());
    expect(await linha(id)).toMatchObject({ ativo: 0 });
    expect((await pulados()).some((x) => x.data === `${ANO}-07-07`)).toBe(false);
  });
});
