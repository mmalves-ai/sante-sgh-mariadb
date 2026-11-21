// Porta do eSocial: a mesma bateria na memória e na própria contra o MariaDB real (cliente f22_o3; F2.2 lote 03-05).
// Bateria comum (describe.each): evento com as ocorrências do XSD, troca de situação pela versão vista e recusa da
// versão velha, retorno aceito com recibo, retificação aceita (o original passa a ser lido como substituído) e lote.
// Só no banco (contrato de efeito): linhas, versão, criado_por/alterado_por do usuário da sessão, trilha da operação,
// nenhuma mensagem no outbox (o eSocial sai pelo lote e pelo transmissor, não pelo outbox), o sequencial do Id pela
// sequencia_negocio do estabelecimento (concorrência sem colisão), o CHECK processado → recibo, a operação do evento
// de tabela, o lote ao coletor, a conferência da conciliação gravada e relida e as recusas por modelo pendente
// (parâmetros do empregador e ficha).
// Massa sintética (identificadores e XML de teste, nenhuma pessoa); o que o teste cria é apagado no fim (a trilha fica:
// é só de inclusão).
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/modulos/pessoas/esocial/porta-esocial-propria.int.spec.ts
import { randomInt } from 'node:crypto';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { NovoRegistroEvento, PortaEsocial } from './porta-esocial.js';
import { PortaEsocialMemoria } from './porta-esocial-memoria.js';
import {
  leiauteDaVersao,
  PortaEsocialPropria,
  SEQUENCIA_EVENTO_ESOCIAL,
  versaoDoLeiaute,
} from './porta-esocial-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const REF = 900_000 + randomInt(90_000);
const LOGIN = 'f22.0305.teste';
const EVENTO = 'S-2230';

let seq = 0;
const idEsocial = () =>
  `ID1112223330001812026${String(REF).padStart(6, '0')}${String(++seq).padStart(5, '0')}`.slice(0, 36);

// Estado comum do banco (preparado uma vez; a bateria do banco e os testes só do banco usam).
let nucleo: NucleoProprio | null = null;
let est = 1;
let usuario: number | null = null;
let sequenciaCriada = false;
const tiposCriados: number[] = [];
const eventos: number[] = [];
const lotes: number[] = [];

const contexto = (): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: 'f22-03-05',
});
const trilhaDo =
  (entidade: string) =>
  (id: unknown): TrilhaDaGravacao =>
    ({
      estabelecimento: est,
      usuario,
      acao: 'operacao',
      entidade,
      entidadeId: typeof id === 'number' ? id : null,
      correlacao: 'f22-03-05',
    }) as unknown as TrilhaDaGravacao;

const novo = (x: Partial<NovoRegistroEvento> = {}): NovoRegistroEvento => ({
  empresa: est,
  evento: EVENTO,
  grupo: 'nao-periodico',
  operacao: null,
  idEsocial: idEsocial(),
  vinculo: null,
  origem: 'afastamento',
  referencia: REF,
  dataReferencia: '2026-10-01',
  leiaute: 'v_S_01_03_00',
  xml: '<eSocial><evtAfastTemp Id="sintetico"/></eSocial>',
  xmlCifrado: false,
  hashXml: 'a'.repeat(64),
  errosXsd: [],
  situacao: 'validado',
  eventoAnterior: null,
  por: 'SINT.TESTE',
  ...x,
});

function incluirEm(porta: PortaEsocial, x: Partial<NovoRegistroEvento> = {}): Promise<number> {
  return porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), async (g) => {
    const sequencial = await g.proximoSequencialEvento();
    expect(sequencial).toBeGreaterThan(0);
    const id = await g.incluirEvento(novo(x));
    eventos.push(id);
    return id;
  });
}

const banco = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'f22-03-05-conferencia' }, (l) =>
    l.uma(sql, p),
  ) as Promise<T>;

beforeAll(async () => {
  if (SEM_BANCO) return;
  nucleo = new NucleoProprio();
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-03-05-preparo' }, async (e) => {
    const x = await e.uma('SELECT id FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
    est = x
      ? Number(x['id'])
      : await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))',
          ['F22-0305', 'Estabelecimento sintético', 'Estabelecimento sintético de teste'],
        );
    const u = await e.uma('SELECT id FROM usuario WHERE login = ?', [LOGIN]);
    usuario = u
      ? Number(u['id'])
      : await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', NOW(3))",
          [LOGIN, 'Usuário sintético do teste do eSocial'],
        );
    const s = await e.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      SEQUENCIA_EVENTO_ESOCIAL,
      est,
    ]);
    sequenciaCriada = !s;
    for (const [codigo, classe] of [
      ['S-1010', 'tabela'],
      [EVENTO, 'nao_periodico'],
    ] as const) {
      const t = await e.uma('SELECT id FROM tipo_evento_esocial WHERE codigo_esocial = ?', [codigo]);
      if (!t)
        tiposCriados.push(
          await e.inserir(
            `INSERT INTO tipo_evento_esocial (codigo_esocial, descricao, classe, versao_fonte, criado_em)
             VALUES (?, ?, ?, 'teste-f22-03-05', NOW(3))`,
            [codigo, `Evento sintético ${codigo}`, classe],
          ),
        );
    }
  });
});

afterAll(async () => {
  if (!nucleo) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-03-05-limpeza' }, async (e) => {
    const em = (xs: readonly number[]) => xs.map(() => '?').join(',');
    const ids = await e.consultar(
      `SELECT id FROM evento_esocial WHERE entidade = 'afastamento' AND entidade_id = ? AND estabelecimento_id = ?`,
      [REF, est],
    );
    const todos = [...new Set([...eventos, ...ids.map((x) => Number(x['id']))])];
    if (todos.length) {
      await e.executar(`DELETE FROM retorno_esocial WHERE evento_esocial_id IN (${em(todos)})`, todos);
      await e.executar(
        `UPDATE evento_esocial SET evento_retificado_id = NULL, tipo_operacao = 'original', lote_esocial_id = NULL
          WHERE id IN (${em(todos)})`,
        todos,
      );
      await e.executar(`DELETE FROM evento_esocial WHERE id IN (${em(todos)})`, todos);
    }
    if (lotes.length) await e.executar(`DELETE FROM lote_esocial WHERE id IN (${em(lotes)})`, lotes);
    await e.executar(
      `DELETE i FROM conferencia_eventos_esocial_item i
         JOIN conferencia_eventos_esocial f ON f.id = i.conferencia_eventos_esocial_id WHERE f.estabelecimento_id = ?`,
      [est],
    );
    await e.executar('DELETE FROM conferencia_eventos_esocial WHERE estabelecimento_id = ?', [est]);
    if (tiposCriados.length)
      await e.executar(`DELETE FROM tipo_evento_esocial WHERE id IN (${em(tiposCriados)})`, tiposCriados);
    if (sequenciaCriada)
      await e.executar('DELETE FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
        SEQUENCIA_EVENTO_ESOCIAL,
        est,
      ]);
  });
  await nucleo.encerrar();
});

it('converte a versão do leiaute entre o catálogo e o XSD', () => {
  expect(leiauteDaVersao('S-1.3')).toBe('v_S_01_03_00');
  expect(versaoDoLeiaute('v_S_01_03_00')).toBe('S-1.3');
  expect(versaoDoLeiaute(leiauteDaVersao('S-1.2.1'))).toBe('S-1.2.1');
});

// ── A mesma bateria na memória e no banco ────────────────────────────────────────────────────────────────────────

const FABRICAS = [
  { nome: 'memória', semBanco: false, criar: (): PortaEsocial => new PortaEsocialMemoria() },
  { nome: 'banco', semBanco: SEM_BANCO, criar: (): PortaEsocial => new PortaEsocialPropria(nucleo!) },
] as const;

describe.each(FABRICAS)('porta do eSocial ($nome): bateria comum', ({ semBanco, criar }) => {
  let porta: PortaEsocial;
  beforeAll(() => {
    if (!semBanco) porta = criar();
  });
  // A versão inicial é a da implementação (memória 0, banco 1 pelo núcleo); a bateria confere o avanço a partir dela.
  const versaoDe = async (id: number) => (await porta.evento(contexto(), id))!.evento.versao;

  it.skipIf(semBanco)('grava o evento inválido com os erros do XSD e relê na situação da tela', async () => {
    const id = await incluirEm(porta, {
      situacao: 'invalido',
      errosXsd: ['campo sintético inválido', 'outro erro sintético'],
    });
    const [lido] = await porta.eventos(contexto(), {
      origem: 'afastamento',
      referencia: REF,
      situacao: 'invalido',
    });
    expect(lido).toMatchObject({ id, evento: EVENTO, grupo: 'nao-periodico', situacao: 'invalido' });
    expect(lido?.errosXsd).toEqual(['campo sintético inválido', 'outro erro sintético']);
    const det = await porta.evento(contexto(), id);
    expect(det?.xml).toContain('evtAfastTemp');
    expect(det?.evento.xmlCifrado).toBe(false);
  });

  it.skipIf(semBanco)(
    'troca a situação pela versão vista, guarda o motivo e recusa a versão velha',
    async () => {
      const id = await incluirEm(porta);
      const v = await versaoDe(id);
      await porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
        g.mudarSituacaoEvento({
          id,
          versao: v,
          situacao: 'descartado',
          motivo: 'Descarte sintético',
          por: 'SINT',
        }),
      );
      expect((await porta.evento(contexto(), id))?.evento).toMatchObject({
        situacao: 'descartado',
        motivo: 'Descarte sintético',
        versao: v + 1,
      });
      await expect(
        porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
          g.mudarSituacaoEvento({ id, versao: v, situacao: 'validado', por: 'SINT' }),
        ),
      ).rejects.toThrow();
      expect((await porta.evento(contexto(), id))?.evento).toMatchObject({
        situacao: 'descartado',
        versao: v + 1,
      });
    },
  );

  it.skipIf(semBanco)(
    'retorno aceito com recibo; a retificação aceita torna o original substituído',
    async () => {
      const original = await incluirEm(porta);
      const v = await versaoDe(original);
      const recibo = `1.1.${REF}.${seq}`;
      await porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
        g.mudarSituacaoEvento({
          id: original,
          versao: v,
          situacao: 'aceito',
          recibo,
          retorno: { codigo: '201', descricao: 'Sucesso sintético' },
          por: 'SINT',
        }),
      );
      expect((await porta.evento(contexto(), original))?.evento).toMatchObject({
        situacao: 'aceito',
        recibo,
        retornoCodigo: '201',
        versao: v + 1,
      });
      const retificacao = await incluirEm(porta, { eventoAnterior: original });
      await porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), async (g) => {
        await g.mudarSituacaoEvento({
          id: retificacao,
          versao: v,
          situacao: 'aceito',
          recibo: `${recibo}.2`,
          retorno: { codigo: '201', descricao: 'Sucesso sintético' },
          por: 'SINT',
        });
        // O serviço marca o original; no banco, o substituído é derivado (a troca só confere a versão).
        await g.mudarSituacaoEvento({ id: original, versao: v + 1, situacao: 'substituido', por: 'SINT' });
      });
      expect((await porta.evento(contexto(), original))?.evento.situacao).toBe('substituido');
      expect((await porta.evento(contexto(), retificacao))?.evento).toMatchObject({
        situacao: 'aceito',
        eventoAnterior: original,
      });
    },
  );

  it.skipIf(semBanco)('monta o lote, põe o evento nele e registra o envio com o protocolo', async () => {
    const ev = await incluirEm(porta);
    const v = await versaoDe(ev);
    const lote = await porta.gravarSgh(contexto(), trilhaDo('lote_esocial'), async (g) => {
      const l = await g.incluirLote({
        empresa: est,
        grupo: 'nao-periodico',
        ambiente: 'producao-restrita',
        quantidade: 1,
        por: 'SINT',
      });
      lotes.push(l);
      await g.mudarSituacaoEvento({ id: ev, versao: v, situacao: 'em-lote', lote: l, por: 'SINT' });
      return l;
    });
    const protocolo = `1.2.${REF}.${seq}`;
    await porta.gravarSgh(contexto(), trilhaDo('lote_esocial'), async (g) => {
      const l = await g.loteComTrava(lote);
      await g.mudarSituacaoLote({
        id: lote,
        versao: l!.versao,
        situacao: 'enviado',
        protocolo,
        enviado: true,
        por: 'SINT',
      });
    });
    expect(await porta.lote(contexto(), lote)).toMatchObject({
      situacao: 'enviado',
      protocolo,
      ambiente: 'producao-restrita',
      grupo: 'nao-periodico',
    });
    const [doLote] = await porta.eventos(contexto(), { lote });
    expect(doLote).toMatchObject({ id: ev, situacao: 'em-lote', lote });
  });
});

// ── Só no banco: o contrato de efeito nas tabelas ───────────────────────────────────────────────────────────────

describe.skipIf(SEM_BANCO)('porta própria do eSocial: contrato de efeito no MariaDB (cliente f22_o3)', () => {
  let porta: PortaEsocialPropria;
  beforeAll(() => {
    porta = new PortaEsocialPropria(nucleo!);
  });
  const contar = async (sql: string, p: unknown[]) => Number((await banco(sql, p))['n']);

  it('linha, versão, autor da sessão, trilha da operação e nenhum outbox; o sequencial vem da sequência', async () => {
    const antes = await contar(
      'SELECT COALESCE(MAX(proximo_valor), 0) AS n FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
      [SEQUENCIA_EVENTO_ESOCIAL, est],
    );
    const id = await incluirEm(porta, { situacao: 'invalido', errosXsd: ['erro sintético'] });
    const linha = await banco(
      `SELECT situacao, versao, ambiente, tipo_operacao, entidade, entidade_id, estabelecimento_id, criado_por,
              DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia
         FROM evento_esocial WHERE id = ?`,
      [id],
    );
    expect(linha).toMatchObject({
      situacao: 'erro_validacao',
      versao: 1,
      ambiente: 'producao_restrita',
      tipo_operacao: 'original',
      entidade: 'afastamento',
      competencia: '2026-10-01',
    });
    expect(Number(linha['entidade_id'])).toBe(REF);
    expect(Number(linha['estabelecimento_id'])).toBe(est);
    expect(Number(linha['criado_por'])).toBe(usuario);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM retorno_esocial WHERE evento_esocial_id = ? AND codigo_resposta = 'XSD'",
        [id],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'evento_esocial' AND entidade_id = ? AND usuario_id = ?",
        [id, usuario],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE entidade = 'evento_esocial' AND entidade_id = ?",
        [id],
      ),
    ).toBe(0);
    const depois = await contar(
      'SELECT proximo_valor AS n FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
      [SEQUENCIA_EVENTO_ESOCIAL, est],
    );
    expect(depois).toBe(Math.max(antes, 1) + 1);
    await porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
      g.mudarSituacaoEvento({
        id,
        versao: 1,
        situacao: 'descartado',
        motivo: 'Descarte sintético',
        por: 'SINT',
      }),
    );
    const alterado = await banco('SELECT situacao, versao, alterado_por FROM evento_esocial WHERE id = ?', [
      id,
    ]);
    expect(alterado).toMatchObject({ situacao: 'cancelado', versao: 2 });
    expect(Number(alterado['alterado_por'])).toBe(usuario);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM retorno_esocial WHERE evento_esocial_id = ? AND codigo_resposta = 'MOTIVO'",
        [id],
      ),
    ).toBe(1);
  });

  it('gerações concorrentes: ids e sequenciais distintos, sem colisão', async () => {
    const ids = await Promise.all([incluirEm(porta), incluirEm(porta), incluirEm(porta)]);
    expect(new Set(ids).size).toBe(3);
    const linhas = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'f22-03-05-conferencia' }, (l) =>
      l.consultar(`SELECT identificador_evento FROM evento_esocial WHERE id IN (?, ?, ?)`, ids),
    );
    expect(new Set(linhas.map((x) => x['identificador_evento'])).size).toBe(3);
  });

  it('o banco recusa o processado sem recibo (CHECK) e nada muda', async () => {
    const id = await incluirEm(porta);
    await expect(
      porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
        g.mudarSituacaoEvento({ id, versao: 1, situacao: 'aceito', por: 'SINT' }),
      ),
    ).rejects.toThrow();
    expect(await banco('SELECT situacao, versao FROM evento_esocial WHERE id = ?', [id])).toMatchObject({
      situacao: 'validado',
      versao: 1,
    });
  });

  it('grava a operação do evento de tabela, a data de referência e o lote ao coletor', async () => {
    const id = await incluirEm(porta, {
      evento: 'S-1010',
      grupo: 'tabela',
      operacao: 'inclusao',
      dataReferencia: '2026-10-15',
    });
    const [lido] = await porta.eventos(contexto(), { referencia: REF, evento: 'S-1010' });
    expect(lido).toMatchObject({ id, operacao: 'inclusao', dataReferencia: '2026-10-15' });
    expect(
      await banco('SELECT operacao_tabela, data_referencia FROM evento_esocial WHERE id = ?', [id]),
    ).toMatchObject({
      operacao_tabela: 'inclusao',
    });
    const lote = await porta.gravarSgh(contexto(), trilhaDo('lote_esocial'), (g) =>
      g.incluirLote({ empresa: est, grupo: 'tabela', ambiente: 'coletor', quantidade: 1, por: 'SINT' }),
    );
    lotes.push(lote);
    expect(await banco('SELECT ambiente FROM lote_esocial WHERE id = ?', [lote])).toMatchObject({
      ambiente: 'coletor',
    });
    expect((await porta.lote(contexto(), lote))?.ambiente).toBe('coletor');
  });

  const linhaDe = (evento: string, situacao: string, externo: number | null, pendenciaLegado: number) => ({
    evento,
    rotulo: 'rótulo da tela',
    sante: 2,
    externo,
    repasse: 0,
    pendenciaLegado,
    situacao,
  });
  const conferir = (competencia: string, situacao: 'conciliada' | 'divergente', linhas: unknown[]) =>
    porta.gravarSgh(contexto(), trilhaDo('conferencia_eventos_esocial'), (g) =>
      g.incluirConciliacao({
        empresa: est,
        competencia,
        transmissor: 'sante',
        situacao,
        linhas: JSON.stringify(linhas),
        observacao: 'Conferência sintética',
        por: 'SINT',
      }),
    );

  it('grava a conferência da conciliação e relê a última, com a situação exata e as contagens por evento', async () => {
    expect(await porta.ultimaConciliacao(contexto(), est, '2026-09')).toBeNull();
    const id = await conferir('2026-09', 'conciliada', [
      linhaDe('S-1010', 'conciliado', 2, 0),
      linhaDe(EVENTO, 'sem-transmissor', null, 3),
    ]);
    const u = await porta.ultimaConciliacao(contexto(), est, '2026-09');
    expect(u).toMatchObject({
      id,
      empresa: est,
      competencia: '2026-09',
      transmissor: 'sante',
      situacao: 'conciliada',
    });
    expect(u?.observacao).toBe('Conferência sintética');
    const lidas = JSON.parse(u!.linhas) as {
      evento: string;
      rotulo: string;
      externo: number | null;
      pendenciaLegado: number;
      situacao: string;
    }[];
    expect(lidas.map((x) => [x.evento, x.externo, x.pendenciaLegado, x.situacao]).sort()).toEqual(
      [
        ['S-1010', 2, 0, 'conciliado'],
        [EVENTO, null, 3, 'sem-transmissor'],
      ].sort(),
    );
    // O rótulo é o nome do tipo de evento no catálogo do cliente (nunca vazio).
    for (const l of lidas) expect(l.rotulo.length).toBeGreaterThan(0);
    expect(
      await porta.ultimaConciliacao({ ...contexto(), estabelecimento: est + 1_000_000 }, est, '2026-09'),
    ).toBeNull();
  });

  it.each([
    ['dois-transmissores', '2026-05'],
    ['repasse-no-periodico', '2026-06'],
    ['repasse-no-externo', '2026-07'],
    ['so-contagem', '2026-08'],
  ])(
    'linha %s: grava as contagens e a releitura recusa com modelo-pendente (nunca outro diagnóstico)',
    async (sit, comp) => {
      await conferir(comp, 'divergente', [linhaDe('S-1010', 'conciliado', 2, 0), linhaDe(EVENTO, sit, 1, 0)]);
      expect(
        await contar(
          `SELECT COUNT(*) AS n FROM conferencia_eventos_esocial_item i
           JOIN conferencia_eventos_esocial f ON f.id = i.conferencia_eventos_esocial_id
          WHERE f.estabelecimento_id = ? AND f.competencia = ? AND i.situacao = 'divergente'`,
          [est, `${comp}-01`],
        ),
      ).toBe(1);
      await expect(porta.ultimaConciliacao(contexto(), est, comp)).rejects.toMatchObject({
        problema: { codigo: 'modelo-pendente' },
      });
      await expect(porta.ultimaConciliacao(contexto(), est, comp)).rejects.toThrow(/detalhe da divergência/);
    },
  );

  it('recusa sem gravar: outro estabelecimento e parâmetros do empregador', async () => {
    const l = () => contar('SELECT COUNT(*) AS n FROM lote_esocial WHERE estabelecimento_id = ?', [est]);
    const lotesAntes = await l();
    await expect(
      porta.gravarSgh(contexto(), trilhaDo('lote_esocial'), (g) =>
        g.incluirLote({
          empresa: est + 1_000_000,
          grupo: 'tabela',
          ambiente: 'producao',
          quantidade: 1,
          por: 'SINT',
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'outro-estabelecimento' } });
    await expect(
      porta.gravarSgh(contexto(), trilhaDo('evento_esocial'), (g) =>
        g.incluirEmpregador({
          empresa: est,
          inicio: '2026-10',
          transmissor: 'sante',
          leiaute: 'v_S_01_03_00',
          parametros: '{}',
          por: 'SINT',
        }),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    expect(await l()).toBe(lotesAntes);
  });

  it('leituras sem lugar no modelo recusam dizendo o que fica indisponível (nunca vazio calado)', async () => {
    await expect(porta.empregadores(contexto(), null)).rejects.toMatchObject({
      problema: { codigo: 'modelo-pendente' },
    });
    await expect(porta.empregadores(contexto(), null)).rejects.toThrow(/gerar eventos/);
    await expect(porta.ficha(contexto(), 1)).rejects.toMatchObject({
      problema: { codigo: 'modelo-pendente' },
    });
  });

  it('não lê registro de outro estabelecimento e lê os catálogos do cliente', async () => {
    const id = await incluirEm(porta);
    const outro = { ...contexto(), estabelecimento: est + 1_000_000 };
    expect(await porta.evento(outro, id)).toBeNull();
    expect(await porta.eventos(outro, { referencia: REF })).toEqual([]);
    const cat = await porta.eventosCatalogo(contexto());
    expect(cat.find((x) => x.codigo === 'S-1010')?.grupo).toBe(1);
    expect((await porta.cnpjs(contexto())).has(est)).toBe(true);
    expect(await porta.recibosAutonomo(contexto(), est, '2001-01')).toBe(0);
    expect(Array.isArray(await porta.pendenciasMigradas(contexto(), null))).toBe(true);
    const cont = await porta.contagemEventos(contexto(), [est], '2026-10-01', '2026-10-31', ['validado']);
    expect(cont[EVENTO]).toBeGreaterThanOrEqual(1);
  });
});
