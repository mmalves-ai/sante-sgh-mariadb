// Contrato de efeito do profissional provisório (F8, 02-CAD linha 21) contra o MariaDB real, no cliente de teste f22_o1,
// com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco: o cadastro
// mínimo em `profissional_provisorio` (número da inscrição normalizado, prazo sugerido de 15 dias) com a trilha; o
// segundo aberto com a mesma inscrição e o sem UF recusados; o registro ligado em `profissional_provisorio_uso` (o
// repetido e o inexistente recusados); cancelar com registro pendente recusado; a prorrogação só para frente; a
// regularização para quem não tem a mesma inscrição recusada; o atendimento encerrado só passa com confirmação explícita
// (sem ela nada muda); confirmada, os atendimentos passam ao definitivo e cada registro ligado guarda o substituto
// declarado ao ligar, o profissional anterior, a situação do registro e a confirmação (a autoria não se perde), e a
// trilha leva a lista antes/depois; o provisório fica regularizado (nada apagado) e nada mais se liga a ele. A busca
// acha o registro pelo número e mostra em nome de quem ele está. O vencido aparece no filtro de vencidos e ainda aceita registro (alerta, sem trava); o cancelado
// fica, com o motivo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_F22,
  contextoPorta,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import {
  type EntradaProvisorioTela,
  ProfissionalProvisorioProprio,
} from './profissional-provisorio-proprio.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f8-02-21-provisorio';
const NOME = `${MARCA} PROVISORIO`;
const NUM_ATEND = `${MARCA}PV`;

const hoje = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const somar = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

describe.skipIf(SEM_BANCO)('profissional provisório no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: ProfissionalProvisorioProprio;
  let m: Massa | null = null;
  let atendimento = 0;
  let encerrado = 0;
  let paciente = 0;
  let prov = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const t = (): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade: 'profissional_provisorio',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.profissional' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const entrada = (p: Partial<EntradaProvisorioTela> = {}): EntradaProvisorioTela => ({
    nome: `${NOME} UM`,
    cpf: null,
    conselhoId: m!.conselho,
    numeroConselho: '0099-0102',
    ufConselhoId: m!.uf,
    ocupacaoId: null,
    especialidadeId: null,
    telefone: null,
    motivo: 'Plantão coberto antes do cadastro completo',
    dataInicio: hoje(),
    prazo: null,
    observacao: null,
    ...p,
  });
  const linha = (id: number) =>
    um<Record<string, unknown>>(
      `SELECT situacao, numero_conselho, prazo_regularizacao, profissional_id, regularizado_em, versao, observacao
         FROM profissional_provisorio WHERE id = ?`,
      [id],
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
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const meus = 'SELECT id FROM profissional_provisorio WHERE nome LIKE ?';
      await e.executar(
        `DELETE FROM profissional_provisorio_uso WHERE profissional_provisorio_id IN (SELECT id FROM (${meus}) x)`,
        [`${NOME}%`],
      );
      await e.executar('DELETE FROM profissional_provisorio WHERE nome LIKE ?', [`${NOME}%`]);
      await e.executar('DELETE FROM atendimento WHERE numero LIKE ?', [`${NUM_ATEND}%`]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new ProfissionalProvisorioProprio(nucleo, CLIENTE_F22);
    // Atendimento sintético que o provisório fez, registrado em nome de outro profissional da massa (o substituto).
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         SELECT ?, ?, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, ?,
                NOW(3), NOW(3) FROM atendimento ORDER BY id LIMIT 1`,
        [m!.estabelecimento, `${NUM_ATEND}-1`, m!.enfermeira],
      );
      // Outro atendimento do provisório, já encerrado (alta): a transferência dele pede confirmação.
      encerrado = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, saida_em, situacao, desfecho,
           criado_em)
         SELECT ?, ?, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, ?,
                NOW(3) - INTERVAL 1 HOUR, NOW(3), 'encerrado', 'alta', NOW(3) FROM atendimento ORDER BY id LIMIT 1`,
        [m!.estabelecimento, `${NUM_ATEND}-2`, m!.enfermeira],
      );
    });
    paciente = Number(
      (await um<{ p: unknown }>('SELECT paciente_id AS p FROM atendimento WHERE id = ?', [atendimento]))!.p,
    );
  }, 120_000);

  afterAll(async () => {
    if (m) await limparMinhas();
    await nucleo?.encerrar?.();
  });

  it('cria o cadastro mínimo com o número normalizado, o prazo de 15 dias e a trilha', async () => {
    prov = await s.criar(c(), entrada(), t());
    const x = await linha(prov);
    expect(x).toMatchObject({ situacao: 'provisorio', numero_conselho: '990102', profissional_id: null });
    expect(
      String(
        x!['prazo_regularizacao'] instanceof Date
          ? (x!['prazo_regularizacao'] as Date).toISOString()
          : x!['prazo_regularizacao'],
      ).slice(0, 10),
    ).toBe(somar(hoje(), 15));
    const tr = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'profissional_provisorio' AND entidade_id = ?",
      [prov],
    );
    expect(Number(tr!.n)).toBeGreaterThan(0);
  });

  it('recusa o segundo aberto com a mesma inscrição e o cadastro sem UF ou sem motivo', async () => {
    expect(await codigo(s.criar(c(), entrada({ nome: `${NOME} DOIS`, numeroConselho: '990102' }), t()))).toBe(
      'provisorio-ja-aberto',
    );
    expect(await codigo(s.criar(c(), entrada({ nome: `${NOME} TRES`, ufConselhoId: null }), t()))).toBe(
      'uf-conselho-ausente',
    );
    expect(await codigo(s.criar(c(), entrada({ nome: `${NOME} TRES`, motivo: 'curto' }), t()))).toBe(
      'motivo-curto',
    );
  });

  it('acha o atendimento pelo número, com o paciente e em nome de quem ele está', async () => {
    const r = await s.buscarRegistros(c(), 'atendimento', `${NUM_ATEND}-1`);
    const x = r.find((k) => k.id === atendimento);
    expect(x).toMatchObject({ numero: `${NUM_ATEND}-1` });
    expect(x!.paciente.length).toBeGreaterThan(0);
    expect(x!.profissional).not.toBeNull();
    expect(await s.buscarRegistros(c(), 'atendimento', 'ab')).toEqual([]);
  });

  it('liga o atendimento e o paciente; o repetido e o inexistente são recusados', async () => {
    await s.ligar(c(), { id: prov, tipo: 'atendimento', registroId: atendimento }, t());
    await s.ligar(c(), { id: prov, tipo: 'paciente', registroId: paciente }, t());
    await s.ligar(c(), { id: prov, tipo: 'atendimento', registroId: encerrado }, t());
    expect(await codigo(s.ligar(c(), { id: prov, tipo: 'atendimento', registroId: atendimento }, t()))).toBe(
      'uso-ja-ligado',
    );
    expect(await codigo(s.ligar(c(), { id: prov, tipo: 'atendimento', registroId: 999_999_999 }, t()))).toBe(
      'registro-inexistente',
    );
    const d = await s.detalhe(c(), prov);
    expect(d.usos.map((u) => [u.sequencia, u.tipo, u.regularizado, u.numero, u.pendencias])).toEqual([
      [1, 'atendimento', false, `${NUM_ATEND}-1`, []],
      [2, 'paciente', false, null, []],
      [3, 'atendimento', false, `${NUM_ATEND}-2`, ['registro-fechado']],
    ]);
    // O substituto declarado (em cujo nome o registro foi feito) fica guardado ao ligar.
    const sub = await um<{ n: unknown; s: unknown }>(
      `SELECT COUNT(*) AS n, SUM(substituto_profissional_id = ?) AS s FROM profissional_provisorio_uso
        WHERE profissional_provisorio_id = ? AND tipo = 'atendimento'`,
      [m!.enfermeira, prov],
    );
    expect([Number(sub!.n), Number(sub!.s)]).toEqual([2, 2]);
    // O definitivo da mesma inscrição aparece como candidato.
    expect(d.candidatos.map((k) => k.id)).toContain(m!.profissional);
  });

  it('não cancela com registro pendente; prorroga só para frente', async () => {
    const v = Number((await linha(prov))!['versao']);
    expect(await codigo(s.cancelar(c(), { id: prov, versao: v, motivo: 'Cadastrado por engano' }, t()))).toBe(
      'usos-pendentes',
    );
    expect(
      await codigo(
        s.prorrogar(
          c(),
          { id: prov, versao: v, prazo: somar(hoje(), 5), motivo: 'Documentos atrasados' },
          t(),
        ),
      ),
    ).toBe('prazo-nao-prorroga');
    await s.prorrogar(
      c(),
      { id: prov, versao: v, prazo: somar(hoje(), 30), motivo: 'Documentos atrasados' },
      t(),
    );
    expect(Number((await linha(prov))!['versao'])).toBe(v + 1);
  });

  it('regulariza só para o definitivo da mesma inscrição; o encerrado pede confirmação; a autoria anterior fica', async () => {
    const v = Number((await linha(prov))!['versao']);
    const reg = (profissional: number, confirmar: boolean) =>
      s.regularizar(c(), { id: prov, versao: v, profissional, confirmar }, t());
    expect(await codigo(reg(m!.enfermeira, true))).toBe('inscricao-diferente');
    // Sem confirmação, o atendimento encerrado barra a transferência: nada muda.
    expect(await codigo(reg(m!.profissional, false))).toBe('transferencia-a-confirmar');
    const profDe = async (id: number) =>
      Number(
        (await um<{ p: unknown }>('SELECT profissional_id AS p FROM atendimento WHERE id = ?', [id]))!.p,
      );
    expect([await profDe(atendimento), await profDe(encerrado)]).toEqual([m!.enfermeira, m!.enfermeira]);
    expect(await linha(prov)).toMatchObject({ situacao: 'provisorio', versao: v });

    const r = await reg(m!.profissional, true);
    expect(r).toEqual({ id: prov, usos: 3, transferidos: 2 });
    expect(await linha(prov)).toMatchObject({ situacao: 'regularizado', profissional_id: m!.profissional });
    expect((await linha(prov))!['regularizado_em']).not.toBeNull();
    expect([await profDe(atendimento), await profDe(encerrado)]).toEqual([m!.profissional, m!.profissional]);
    // Cada registro transferido guarda quem estava antes, a situação e se a transferência foi confirmada.
    const usos = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) =>
      l.consultar(
        `SELECT sequencia, regularizado, anterior_profissional_id AS ant, situacao_registro_transferencia AS sit,
                transferencia_confirmada AS conf, transferido_em IS NOT NULL AS tr
           FROM profissional_provisorio_uso WHERE profissional_provisorio_id = ? ORDER BY sequencia`,
        [prov],
      ),
    );
    expect(
      usos.map((u) => [
        Number(u['sequencia']),
        Number(u['regularizado']),
        u['ant'] === null ? null : Number(u['ant']),
        u['sit'],
        Number(u['conf']),
        Number(u['tr']),
      ]),
    ).toEqual([
      [1, 1, m!.enfermeira, 'aberto', 0, 1],
      [2, 1, null, null, 0, 0],
      [3, 1, m!.enfermeira, 'encerrado', 1, 1],
    ]);
    const tr = await um<{ d: unknown }>(
      `SELECT dados_depois AS d FROM trilha_auditoria WHERE entidade = 'profissional_provisorio' AND entidade_id = ?
        ORDER BY id DESC LIMIT 1`,
      [prov],
    );
    const dados = typeof tr!.d === 'string' ? JSON.parse(tr!.d) : tr!.d;
    expect(JSON.stringify(dados)).toContain(`"antes":${m!.enfermeira}`);
    const d = await s.detalhe(c(), prov);
    expect(d.usos.filter((u) => u.anterior !== null).length).toBe(2);
    expect(await codigo(s.ligar(c(), { id: prov, tipo: 'paciente', registroId: paciente }, t()))).toBe(
      'provisorio-encerrado',
    );
  });

  it('o vencido entra no filtro de vencidos e ainda aceita registro (alerta, sem trava)', async () => {
    const id = await s.criar(
      c(),
      entrada({
        nome: `${NOME} VENCIDO`,
        numeroConselho: '770102',
        dataInicio: somar(hoje(), -20),
        prazo: somar(hoje(), -5),
      }),
      t(),
    );
    const v = await s.visao(c(), 'vencidos');
    const item = v.itens.find((i) => i.id === id);
    expect(item).toMatchObject({ estadoPrazo: 'vencido', diasParaPrazo: -5, usos: 0 });
    expect(v.itens.every((i) => i.estadoPrazo === 'vencido')).toBe(true);
    expect(v.resumo.vencidos).toBeGreaterThanOrEqual(1);
    await s.ligar(c(), { id, tipo: 'paciente', registroId: paciente }, t());
  });

  it('cancela o aberto sem registro, com o motivo; a linha fica', async () => {
    const id = await s.criar(c(), entrada({ nome: `${NOME} ENGANO`, numeroConselho: '660102' }), t());
    const v = Number((await linha(id))!['versao']);
    expect(await codigo(s.cancelar(c(), { id, versao: v, motivo: 'curto' }, t()))).toBe('motivo-curto');
    await s.cancelar(c(), { id, versao: v, motivo: 'Cadastrado por engano na recepção' }, t());
    expect(await linha(id)).toMatchObject({ situacao: 'cancelado' });
    expect(String((await linha(id))!['observacao'])).toContain('Cadastrado por engano');
    const todos = await s.visao(c(), 'todos');
    expect(todos.itens.find((i) => i.id === id)?.estadoPrazo).toBe('encerrado');
  });
});
