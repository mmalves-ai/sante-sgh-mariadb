// Integração da porta própria da rede credenciada contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA (documentos
// com os dígitos calculados, nenhum de pessoa ou empresa real). A bateria comum (credenciar, ler, alterar com o
// movimento, versão velha, documento repetido, saída agendada cancelada e reinclusão com o mesmo número) roda sobre as duas fábricas (memória e
// banco); depois, o contrato de efeito no banco: as linhas do prestador, do contrato escrito, do histórico e dos
// movimentos, a trilha, o escopo do estabelecimento, a lista paginada, as contagens e o apoio da tela.
// SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  CLIENTE,
  COD,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  PODE,
  prepararBase,
} from './infra/copia.spec-util.js';
import type { CamposPrestador, ContextoRede, GravacaoRede, GravadorRede, PortaRedeOperadora } from './rede-porta.js';
import { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';
import { PortaRedeOperadoraPropria } from './rede-porta-propria.js';
import { ServicoRedeOperadora } from './rede-servico.js';

const campos = (nome: string, extra: Partial<CamposPrestador> = {}): CamposPrestador => ({
  nome,
  nomeFantasia: null,
  cnes: '9021001',
  uf: 'SP',
  municipioIbge: 3550308,
  tipo: 3,
  natureza: 1,
  classificacao: 1,
  contratacao: 1,
  operadoraIntermediaria: null,
  disponibilidade: 1,
  isencaoOnus: 1,
  urgencia: true,
  regime: 2,
  remuneracao: 1,
  contrato: { numero: `L0210-${nome.slice(-2)}`, inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 6 },
  ehOHospital: false,
  estabelecimento: null,
  convenio: null,
  ...extra,
});

const daqui = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
const ctxFixo: ContextoRede = {
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste-02-10',
  rede: 'rede-teste',
  hospital: 'memoria-l0210',
};

const linha =
  (c: ContextoRede) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    acao: 'operacao',
    entidade: 'prestador_rede',
    entidadeId: r.id,
    dadosDepois: { evento: 'teste.l0210.rede', recurso: 'operadora.rede' },
    correlacao: 'teste-02-10',
  });

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
  massa = await prepararBase(nucleo);
  await limparMassa(nucleo, massa);
  // A operadora do estabelecimento de teste (o contrato com o prestador é dela).
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-10' }, async (e) => {
    const agora = new Date();
    const pj = await e.inserir('INSERT INTO pessoa_juridica (cnpj, razao_social, criado_em) VALUES (?, ?, ?)', [
      cnpjSintetico('902100000201'),
      'OPERADORA SINTETICA DA REDE L0210',
      agora,
    ]);
    const ope = await e.inserir(
      `INSERT INTO operadora_saude (pessoa_juridica_id, nome, registro_ans, modalidade, segmentacao, criado_em)
       VALUES (?, 'OPERADORA REDE L0210', '902102', 'medicina_grupo', 'medico_hospitalar', ?)`,
      [pj, agora],
    );
    await e.inserir(
      'INSERT INTO operadora_saude_estabelecimento (operadora_saude_id, estabelecimento_id, principal, vigencia_inicio, criado_em) VALUES (?, ?, TRUE, ?, ?)',
      [ope, massa?.est, '2020-01-01', agora],
    );
    const fonte =
      (await e.uma<{ id: unknown }>("SELECT id FROM fonte_pagadora WHERE codigo = 'L0210-OPE'"))?.['id'] ??
      (await e.inserir(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, registro_ans, criado_em) VALUES ('L0210-OPE', 'OPERADORA PROPRIA L0210', 'operadora', 'ativa', '902102', ?)",
        [agora],
      ));
    if (!(await e.uma('SELECT id FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?', [fonte, massa?.est])))
      await e.inserir(
        'INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, criado_em) VALUES (?, ?, ?)',
        [fonte, massa?.est, agora],
      );
  });
});

afterAll(async () => {
  if (!nucleo) return;
  if (massa) await limparMassa(nucleo, massa);
  await nucleo.encerrar();
});

const fabricas: [string, () => { porta: PortaRedeOperadora; c: ContextoRede }][] = [
  ['memória', () => ({ porta: new PortaRedeOperadoraMemoria(), c: ctxFixo })],
  ...(PODE
    ? ([
        [
          'banco',
          () => {
            if (!nucleo || !massa) throw new Error('sem banco');
            return { porta: new PortaRedeOperadoraPropria(nucleo, CLIENTE), c: contexto(massa) };
          },
        ],
      ] as [string, () => { porta: PortaRedeOperadora; c: ContextoRede }][])
    : []),
];

describe.each(fabricas)('rede credenciada, bateria comum (%s)', (destino, fabrica) => {
  it('credencia, lê, altera com o movimento, recusa versão velha e documento repetido, agenda a saída e reinclui', async () => {
    const { porta, c } = fabrica();
    const gravar = <T extends GravacaoRede>(fn: (g: GravadorRede) => Promise<T>) => porta.gravar(c, linha(c), fn);
    const doc = cnpjSintetico(destino === 'banco' ? '902100000301' : '902100000401');
    const cred = await gravar((g) => g.credenciar({ ...campos('HOSPITAL SINTETICO L0210 A1'), pessoa: 'J', documento: doc, usuario: 'x' }));
    expect(cred.versao).toBe(1);
    const p = await porta.prestador(c, cred.id);
    expect(p).toMatchObject({
      pessoa: 'J',
      documento: doc,
      nome: 'HOSPITAL SINTETICO L0210 A1',
      tipo: 3,
      regime: 2,
      classificacao: 1,
      situacao: 'credenciado',
      saidaEm: null,
      contrato: { numero: 'L0210-A1', inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 6 },
      versao: 1,
    });
    expect(
      await codigoDe(gravar((g) => g.credenciar({ ...campos('OUTRO NOME L0210 A2'), pessoa: 'J', documento: doc, usuario: 'x' }))),
    ).toBe('documento-ja-credenciado');

    const alt = await gravar((g) =>
      g.alterar({ ...campos('HOSPITAL SINTETICO L0210 B1'), id: cred.id, versao: 1, camposRps: ['nome'], usuario: 'x' }),
    );
    expect(alt.versao).toBe(2);
    expect(alt.movimento).not.toBeNull();
    const movs = await porta.movimentos(c, { prestador: cred.id });
    expect(movs.itens.map((x) => [x.movimento, x.campos, x.situacao])).toEqual([
      [2, ['nome'], 'pendente'],
      [1, [], expect.any(String)],
    ]);
    expect(
      await codigoDe(gravar((g) => g.alterar({ ...campos('X L0210 C1'), id: cred.id, versao: 1, camposRps: [], usuario: 'x' }))),
    ).toBe('prestador-desatualizado');

    const efetivo = daqui(40);
    await gravar((g) =>
      g.descredenciar({
        id: cred.id,
        versao: 2,
        motivo: 'Pedido do prestador (sintético)',
        efetivoEm: efetivo,
        avisoBeneficiariosEm: daqui(0),
        substituto: null,
        autorizacaoAns: null,
        usuario: 'x',
      }),
    );
    expect(await porta.prestador(c, cred.id)).toMatchObject({
      situacao: 'credenciado',
      saidaEm: efetivo,
      motivoSituacao: 'Pedido do prestador (sintético)',
      versao: 3,
    });
    // Cancelar a saída agendada: o mesmo contrato (mesmo número) segue, com os termos informados.
    await gravar((g) =>
      g.reincluir({
        id: cred.id,
        versao: 3,
        motivo: 'Saída cancelada (sintético)',
        contrato: { numero: 'L0210-A1', inicio: '2026-01-01', fim: null, formaReajuste: 2, mesReajuste: 3 },
        usuario: 'x',
      }),
    );
    expect(await porta.prestador(c, cred.id)).toMatchObject({
      situacao: 'credenciado',
      saidaEm: null,
      contrato: { numero: 'L0210-A1', formaReajuste: 2, mesReajuste: 3 },
      versao: 4,
    });
    // Descredenciado de fato e reincluído com o mesmo número do contrato anterior: aceito nas duas.
    await gravar((g) =>
      g.descredenciar({
        id: cred.id,
        versao: 4,
        motivo: 'Saída efetiva (sintético)',
        efetivoEm: daqui(-1),
        avisoBeneficiariosEm: daqui(-31),
        substituto: null,
        autorizacaoAns: null,
        usuario: 'x',
      }),
    );
    expect((await porta.prestador(c, cred.id))?.situacao).toBe('descredenciado');
    await gravar((g) =>
      g.reincluir({
        id: cred.id,
        versao: 5,
        motivo: 'Volta à rede (sintético)',
        contrato: { numero: 'L0210-A1', inicio: daqui(0), fim: null, formaReajuste: 2, mesReajuste: 4 },
        usuario: 'x',
      }),
    );
    expect(await porta.prestador(c, cred.id)).toMatchObject({
      situacao: 'credenciado',
      saidaEm: null,
      contrato: { numero: 'L0210-A1', formaReajuste: 2, mesReajuste: 4 },
      versao: 6,
    });
    expect((await porta.movimentos(c, { prestador: cred.id })).itens.map((x) => x.movimento)).toEqual([4, 3, 4, 3, 2, 1]);
    if (destino === 'banco' && nucleo) {
      // No banco: um contrato só (a mesma linha reaberta), vigente, e o histórico de cada passo.
      const k = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
        l.uma<Record<string, unknown>>(
          `SELECT COUNT(*) AS n, MAX(situacao) AS situacao, MAX(encerrado_em) AS encerrado,
                  (SELECT COUNT(*) FROM prestador_rede_historico h WHERE h.prestador_rede_id = ?) AS historicos
             FROM contrato_rede_prestador WHERE prestador_rede_id = ?`,
          [cred.id, cred.id],
        ),
      );
      expect(Number(k?.['n'])).toBe(1);
      expect(k).toMatchObject({ situacao: 'vigente', encerrado: null });
      expect(Number(k?.['historicos'])).toBe(5);
    }
  });
});

describe.skipIf(!PODE)('rede credenciada no banco: contrato de efeito, escopo, lista e apoio', () => {
  it('o que fica no banco, a trilha, o escopo, a lista por chave, as contagens e o apoio', async () => {
    if (!nucleo || !massa) throw new Error('sem banco');
    const n = nucleo;
    const m = massa;
    const porta = new PortaRedeOperadoraPropria(n, CLIENTE);
    const c = contexto(m);
    const outro = contexto(m, true);
    const gravar = <T extends GravacaoRede>(fn: (g: GravadorRede) => Promise<T>) => porta.gravar(c, linha(c), fn);
    const cpf = cpfSintetico('902100003');
    const pf = await gravar((g) =>
      g.credenciar({
        ...campos('CONSULTORIO SINTETICO L0210 F1', { tipo: 1, classificacao: 3, cnes: null, urgencia: false, regime: 1 }),
        pessoa: 'F',
        documento: cpf,
        usuario: 'x',
      }),
    );
    const hosp = await gravar((g) =>
      g.credenciar({
        ...campos('HOSPITAL PROPRIO L0210 H1', { ehOHospital: true, estabelecimento: COD }),
        pessoa: 'J',
        documento: cnpjSintetico('902100000501'),
        usuario: 'x',
      }),
    );
    expect(
      await codigoDe(
        gravar((g) =>
          g.credenciar({
            ...campos('HOSPITAL PROPRIO L0210 H2', { ehOHospital: true, estabelecimento: COD }),
            pessoa: 'J',
            documento: cnpjSintetico('902100000502'),
            usuario: 'x',
          }),
        ),
      ),
    ).toBe('hospital-ja-na-rede');
    const linhaBanco = await n.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
      l.uma<Record<string, unknown>>(
        `SELECT p.pessoa, p.cpf, p.cnpj, p.estabelecimento_id, p.situacao, p.versao, p.forma_remuneracao,
                (SELECT COUNT(*) FROM contrato_rede_prestador k WHERE k.prestador_rede_id = p.id) AS contratos,
                (SELECT COUNT(*) FROM prestador_rede_historico h WHERE h.prestador_rede_id = p.id) AS historicos,
                (SELECT COUNT(*) FROM movimento_rede_ans x WHERE x.prestador_rede_id = p.id AND x.tipo_movimento = 'inclusao') AS inclusoes,
                (SELECT COUNT(*) FROM trilha_auditoria t WHERE t.entidade = 'prestador_rede' AND t.entidade_id = p.id
                    AND t.estabelecimento_id = ? AND t.usuario_id = ?) AS trilhas
           FROM prestador_rede p WHERE p.id = ?`,
        [m.est, m.usuario, pf.id],
      ),
    );
    expect(linhaBanco).toMatchObject({ pessoa: 'fisica', cpf, cnpj: null, situacao: 'credenciado', forma_remuneracao: 'procedimento' });
    expect(Number(linhaBanco?.['estabelecimento_id'])).toBe(m.est);
    for (const k of ['contratos', 'historicos', 'inclusoes', 'trilhas']) expect(Number(linhaBanco?.[k]), k).toBe(1);
    expect(await porta.prestador(c, hosp.id)).toMatchObject({ ehOHospital: true, estabelecimento: COD });

    // Escopo: o outro estabelecimento não vê nem grava.
    expect(await porta.prestador(outro, pf.id)).toBeNull();
    expect((await porta.prestadores(outro, {})).itens).toEqual([]);
    expect(
      await codigoDe(
        porta.gravar(outro, linha(outro), (g) =>
          g.alterar({ ...campos('X L0210 Z1'), id: pf.id, versao: 1, camposRps: [], usuario: 'x' }),
        ),
      ),
    ).toBe('prestador-desatualizado');

    // Lista: busca por trecho do nome (sem acento nem caixa), por documento, por tipo e a página pela chave.
    const todos = await porta.prestadores(c, {});
    expect(todos.itens.map((p) => p.nome)).toEqual([...todos.itens.map((p) => p.nome)].sort((a, b) => a.localeCompare(b)));
    expect((await porta.prestadores(c, { busca: 'consultório sintético' })).itens.map((p) => p.id)).toEqual([pf.id]);
    expect((await porta.prestadores(c, { busca: cpf })).itens.map((p) => p.id)).toEqual([pf.id]);
    expect((await porta.prestadores(c, { tipo: 1 })).itens.map((p) => p.id)).toEqual([pf.id]);
    const p1 = await porta.prestadores(c, { limite: 1 });
    expect(p1.itens).toHaveLength(1);
    expect(p1.proxima).not.toBeNull();
    const p2 = await porta.prestadores(c, { limite: 1, ...(p1.proxima ? { apos: p1.proxima } : {}) });
    expect(p2.itens[0]?.id).not.toBe(p1.itens[0]?.id);
    const totais = await porta.totais(c);
    expect(totais.credenciados).toBeGreaterThanOrEqual(2);
    expect(totais.hospitalares).toBeGreaterThanOrEqual(1);
    expect(totais.rpsPendentes).toBeGreaterThanOrEqual(2);
    expect((await porta.movimentos(c, { situacao: 'pendente' })).itens.length).toBeGreaterThanOrEqual(2);

    // O apoio da tela: os domínios do banco com os rótulos e o convênio do estabelecimento.
    const apoio = await new ServicoRedeOperadora(porta).apoio(c, {
      ligada: true,
      motivo: null,
      podeEditar: true,
      estabelecimentos: [{ codigo: COD, nome: 'Estabelecimento de teste' }],
    });
    expect(apoio.dominios.tipo.map((x) => x.codigo)).toEqual(expect.arrayContaining([1, 3]));
    expect(apoio.dominios.remuneracao.map((x) => x.codigo)).toEqual([1, 2, 4]);
    expect(apoio.convenios).toEqual(expect.arrayContaining([expect.objectContaining({ nome: 'OPERADORA PROPRIA L0210', registroAns: 902102 })]));
    expect(apoio.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Município de outra UF: recusa pelo campo.
    expect(
      await codigoDe(
        gravar((g) =>
          g.credenciar({ ...campos('X L0210 U1', { uf: 'RJ' }), pessoa: 'J', documento: cnpjSintetico('902100000601'), usuario: 'x' }),
        ),
      ),
    ).toBe('municipio-fora-da-uf');
  });
});
