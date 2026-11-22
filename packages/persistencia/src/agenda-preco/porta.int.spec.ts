// Integração da porta do ADR 0009 contra o MariaDB, no cliente de teste do agente (SGH_CLIENTE_TESTE, padrão
// adr9_modelo, criado por `python3 -I tools/db/criar_cliente.py adr9_modelo ...` e apagado no fim). Massa SINTÉTICA
// com o prefixo a9m, montada e limpa aqui. Cobre os CHECK do DDL (dono único, alvo único), a cópia íntegra do texto
// (sem corte), o hash e a reextração, o credenciamento (alerta ou bloqueio é opção do convênio; credenciar todos) e
// as perguntas de aceite lidas da regra estruturada com o texto original ao lado.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { esquemaAgendaEstruturada } from '@sgh/contratos';
import { type Escritor, type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aplicarPrecosConsultaOrigem,
  candidatasPrecoParticular,
  credenciamentosVigentes,
  credenciarTodosAtivos,
  definirOpcoesCredenciamentoConvenio,
  fonteParticularPadrao,
  gravarTextoOrigemAgenda,
  gravarTrechosTexto,
  hashTextoAgenda,
  incluirCoberturaAgenda,
  incluirCredenciamento,
  incluirPreparoAgenda,
  incluirRegraPrecoParticular,
  incluirRestricaoAgenda,
  lerAgendaEstruturada,
  listarRegrasPrecoParticular,
  opcoesCredenciamentoConvenio,
  retirarEstimadasDoTexto,
  revisarRegraPrecoParticular,
} from '../index.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'adr9_modelo';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const DIA = '2026-11-22';
/** Texto sintético longo (acima dos 2.000 caracteres do limite antigo), com quebras. */
const TEXTO =
  'CONSULTA PARTICULAR R$ 250,00\nATENDE ASSIM SOMENTE PLANO OURO; NAO ATENDE PLANO BRONZE\n' +
  'ATENDE A PARTIR DE 12 ANOS\n' +
  'Observacao sem regra: '.padEnd(2_600, 'x');

interface Ids {
  est: number;
  prof: number;
  prof2: number;
  particular: number;
  convenio: number;
  ouro: number;
  bronze: number;
  agenda: number;
}

describe.skipIf(SEM_BANCO)('porta do ADR 0009 (preço particular, credenciamento, agenda estruturada)', () => {
  let nucleo: NucleoProprio;
  const ids = {} as Ids;
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-adr9-modelo' }, fn);
  const ler = <T>(fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-adr9-modelo' }, fn);

  const limpar = async (e: Escritor) => {
    await e.executar(
      "DELETE FROM preco_consulta_origem WHERE fonte_pagadora_id IN (SELECT id FROM fonte_pagadora WHERE codigo LIKE 'a9m%')",
    );
    const ag = "(SELECT id FROM agenda_servico WHERE nome LIKE 'a9m%')";
    for (const t of ['regra_preco_particular', 'agenda_cobertura', 'agenda_restricao', 'agenda_preparo'])
      await e.executar(
        `DELETE FROM ${t} WHERE agenda_servico_id IN ${ag}` +
          (t === 'regra_preco_particular'
            ? " OR profissional_id IN (SELECT p.id FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome LIKE 'a9m%')"
            : ''),
      );
    await e.executar(
      `DELETE t FROM trecho_texto_agenda t JOIN texto_origem_agenda o ON o.id = t.texto_origem_agenda_id WHERE o.agenda_servico_id IN ${ag}`,
    );
    await e.executar(`DELETE FROM texto_origem_agenda WHERE agenda_servico_id IN ${ag}`);
    await e.executar(`DELETE FROM agenda_fonte_pagadora WHERE agenda_servico_id IN ${ag}`);
    await e.executar("DELETE FROM agenda_servico WHERE nome LIKE 'a9m%'");
    await e.executar(
      "DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id IN (SELECT id FROM fonte_pagadora WHERE codigo LIKE 'a9m%')",
    );
    await e.executar(
      "DELETE FROM plano_fonte_pagadora WHERE codigo LIKE 'a9m%' AND plano_superior_id IS NOT NULL",
    );
    await e.executar("DELETE FROM plano_fonte_pagadora WHERE codigo LIKE 'a9m%'");
    await e.executar("DELETE FROM fonte_pagadora WHERE codigo LIKE 'a9m%'");
    await e.executar(
      "DELETE p FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome LIKE 'a9m%'",
    );
    await e.executar("DELETE FROM pessoa_fisica WHERE nome LIKE 'a9m%'");
    await e.executar("DELETE FROM categoria_agenda WHERE codigo LIKE 'a9m%'");
    await e.executar("DELETE FROM estabelecimento WHERE codigo = 'a9m'");
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await escrever(async (e) => {
      await limpar(e);
      const agora = 'CURRENT_TIMESTAMP(3)';
      ids.est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES ('a9m', 'a9m Hospital', 'a9m Hospital Ltda', ${agora})`,
      );
      const prof = async (nome: string) => {
        const pf = await e.inserir(`INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ${agora})`, [
          nome,
        ]);
        return e.inserir(
          `INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ${agora})`,
          [pf],
        );
      };
      ids.prof = await prof('a9m Medico X');
      ids.prof2 = await prof('a9m Medico Y');
      const fonte = (codigo: string, tipo: string) =>
        e.inserir(`INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ${agora})`, [
          codigo,
          codigo,
          tipo,
        ]);
      ids.particular = await fonte('a9mpart', 'particular');
      ids.convenio = await fonte('a9mconv', 'operadora');
      const plano = (codigo: string, sup: number | null) =>
        e.inserir(
          `INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, plano_superior_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?, ${agora})`,
          [ids.convenio, sup, codigo, codigo],
        );
      const raiz = await plano('a9mraiz', null);
      ids.ouro = await plano('a9mouro', raiz);
      ids.bronze = await plano('a9mbronze', raiz);
      const cat = await e.inserir(
        `INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES ('a9mcat', 'a9m', ${agora})`,
      );
      ids.agenda = await e.inserir(
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos,
           codigo_origem, observacao, criado_em) VALUES (?, 'a9m Agenda X', ?, ?, 20, '9001', ?, ${agora})`,
        [ids.est, cat, ids.prof, TEXTO],
      );
      await e.inserir(
        `INSERT INTO agenda_fonte_pagadora (agenda_servico_id, fonte_pagadora_id, criado_em) VALUES (?, ?, ${agora}), (?, ?, ${agora})`,
        [ids.agenda, ids.particular, ids.agenda, ids.convenio],
      );
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await escrever((e) => limpar(e));
      await nucleo.encerrar();
    }
  });

  it('DDL: a observação da agenda guarda o texto sem corte (acima de 2.000 caracteres)', async () => {
    const u = await ler(async (l) =>
      l.uma('SELECT CHAR_LENGTH(observacao) AS n FROM agenda_servico WHERE id = ?', [ids.agenda]),
    );
    expect(Number(u!['n'])).toBe(TEXTO.length);
    expect(TEXTO.length).toBeGreaterThan(2_000);
  });

  it('DDL: CHECK de dono único e de alvo único na regra de preço particular', async () => {
    const tenta = (sql: string, p: unknown[]) => escrever((e) => e.inserir(sql, p));
    const cols =
      'INSERT INTO regra_preco_particular (fonte_pagadora_id, profissional_id, agenda_servico_id, alvo, item_faturavel_id, valor, vigencia_inicio) VALUES (?,?,?,?,?,?,?)';
    await expect(
      tenta(cols, [ids.particular, ids.prof, ids.agenda, 'consulta', null, 1, DIA]),
    ).rejects.toThrow();
    await expect(tenta(cols, [ids.particular, null, null, 'consulta', null, 1, DIA])).rejects.toThrow();
    await expect(tenta(cols, [ids.particular, ids.prof, null, 'item', null, 1, DIA])).rejects.toThrow();
    await expect(tenta(cols, [ids.particular, ids.prof, null, 'consulta', null, -1, DIA])).rejects.toThrow();
    // alvo exame (exame padrão da agenda, sem item): só com dono agenda e sem item
    await expect(tenta(cols, [ids.particular, ids.prof, null, 'exame', null, 1, DIA])).rejects.toThrow();
    const exame = await tenta(cols, [ids.particular, null, ids.agenda, 'exame', null, 180, DIA]);
    const lida = await ler((l) => listarRegrasPrecoParticular(l, { agendaId: ids.agenda }));
    expect(lida.find((r) => r.id === exame)?.alvo).toEqual({ tipo: 'exame' });
    await escrever((e) => e.executar('DELETE FROM regra_preco_particular WHERE id = ?', [exame]));
  });

  it('preço particular: regra do médico e da agenda, candidatas vigentes, revisão (recusada sai)', async () => {
    const [rMed, rAg] = await escrever(async (e) => [
      await incluirRegraPrecoParticular(
        e,
        {
          estabelecimentoId: null,
          fontePagadoraId: ids.particular,
          dono: { tipo: 'profissional', profissionalId: ids.prof },
          alvo: { tipo: 'consulta' },
          valor: 300,
          prioridade: 100,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          situacaoRevisao: 'confirmada',
          textoOrigemId: null,
          observacao: null,
        },
        null,
        'migracao',
      ),
      await incluirRegraPrecoParticular(
        e,
        {
          estabelecimentoId: ids.est,
          fontePagadoraId: ids.particular,
          dono: { tipo: 'agenda', agendaId: ids.agenda },
          alvo: { tipo: 'consulta' },
          valor: 250,
          prioridade: 100,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: '2026-12-31',
          situacaoRevisao: 'estimada',
          textoOrigemId: null,
          observacao: null,
        },
        null,
      ),
    ]);
    const q = {
      fontePagadoraId: ids.particular,
      profissionalId: ids.prof,
      agendaId: ids.agenda,
      estabelecimentoId: ids.est,
    };
    const c = await ler((l) => candidatasPrecoParticular(l, { ...q, data: DIA }));
    expect(c.map((r) => [r.id, r.valor, r.situacaoRevisao])).toEqual([
      [rMed, 300, 'confirmada'],
      [rAg, 250, 'estimada'],
    ]);
    expect(await ler((l) => candidatasPrecoParticular(l, { ...q, data: '2027-01-02' }))).toHaveLength(1);
    expect(await escrever((e) => revisarRegraPrecoParticular(e, rAg!, 1, 'recusada', null))).toBe(1);
    expect(await escrever((e) => revisarRegraPrecoParticular(e, rAg!, 1, 'confirmada', null))).toBe(0); // versão velha
    expect((await ler((l) => candidatasPrecoParticular(l, { ...q, data: DIA }))).map((r) => r.id)).toEqual([
      rMed,
    ]);
    expect(await ler((l) => listarRegrasPrecoParticular(l, { agendaId: ids.agenda }))).toHaveLength(1);
    expect(await ler((l) => fonteParticularPadrao(l, 'a9mpart'))).toBe(ids.particular);
  });

  it('credenciamento: opções do convênio (alerta por padrão), vigentes e credenciar todos os ativos', async () => {
    expect(await ler((l) => opcoesCredenciamentoConvenio(l, ids.convenio))).toEqual({
      fontePagadoraId: ids.convenio,
      bloqueiaSemCredenciamento: false,
      credenciaTodosAoCriar: false,
    });
    await escrever((e) =>
      definirOpcoesCredenciamentoConvenio(
        e,
        { fontePagadoraId: ids.convenio, bloqueiaSemCredenciamento: true, credenciaTodosAoCriar: true },
        null,
      ),
    );
    expect((await ler((l) => opcoesCredenciamentoConvenio(l, ids.convenio)))!.bloqueiaSemCredenciamento).toBe(
      true,
    );
    const q = {
      profissionalId: ids.prof,
      fontePagadoraId: ids.convenio,
      estabelecimentoId: ids.est,
      data: DIA,
    };
    expect(await ler((l) => credenciamentosVigentes(l, q))).toEqual([]);
    await escrever((e) =>
      incluirCredenciamento(
        e,
        {
          profissionalId: ids.prof,
          fontePagadoraId: ids.convenio,
          estabelecimentoId: null,
          planoId: null,
          credenciado: true,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
        },
        null,
      ),
    );
    expect(await ler((l) => credenciamentosVigentes(l, q))).toHaveLength(1);
    // credenciar todos: só quem falta (o médico Y; os ativos de outras massas do banco também entram, então >= 1)
    const n = await escrever((e) => credenciarTodosAtivos(e, ids.convenio, DIA, null, ['corpo_clinico']));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await ler((l) => credenciamentosVigentes(l, { ...q, profissionalId: ids.prof2 }))).toHaveLength(1);
    expect(await escrever((e) => credenciarTodosAtivos(e, ids.convenio, DIA, null, ['corpo_clinico']))).toBe(
      0,
    ); // idempotente
  });

  it('texto original íntegro com hash; mudou, volta a pendente e as estimadas saem; trechos marcados', async () => {
    const t1 = await escrever((e) =>
      gravarTextoOrigemAgenda(
        e,
        { agendaId: ids.agenda, fontePagadoraId: null, campo: 'observacao', texto: TEXTO },
        null,
        'migracao',
      ),
    );
    expect(t1.mudou).toBe(true);
    expect(
      (
        await escrever((e) =>
          gravarTextoOrigemAgenda(
            e,
            { agendaId: ids.agenda, fontePagadoraId: null, campo: 'observacao', texto: TEXTO },
            null,
          ),
        )
      ).mudou,
    ).toBe(false);
    const fim = TEXTO.indexOf('\n');
    await escrever((e) =>
      gravarTrechosTexto(
        e,
        t1.id,
        [
          { inicio: 0, fim, interpretado: true, tipoRegra: 'preco', motivo: null },
          {
            inicio: TEXTO.indexOf('Observacao'),
            fim: TEXTO.length,
            interpretado: false,
            tipoRegra: null,
            motivo: 'sem padrão conhecido',
          },
        ],
        'x1',
        null,
      ),
    );
    await escrever((e) =>
      incluirPreparoAgenda(
        e,
        {
          agendaId: ids.agenda,
          itemAgendavelId: null,
          tipo: 'preparo',
          descricao: 'Jejum de 8 horas',
          jejumHoras: 8,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          situacaoRevisao: 'estimada',
          textoOrigemId: t1.id,
        },
        null,
      ),
    );
    const novo = TEXTO.replace('250,00', '280,00');
    const t2 = await escrever((e) =>
      gravarTextoOrigemAgenda(
        e,
        { agendaId: ids.agenda, fontePagadoraId: null, campo: 'observacao', texto: novo },
        null,
      ),
    );
    expect(t2).toEqual({ id: t1.id, mudou: true });
    expect(await escrever((e) => retirarEstimadasDoTexto(e, t1.id, null))).toBe(1);
    const u = await ler((l) =>
      l.uma(
        'SELECT situacao_estruturacao AS s, LOWER(HEX(hash_texto)) AS h, LOWER(LEFT(SHA2(texto,256),32)) AS hb, CHAR_LENGTH(texto) AS n FROM texto_origem_agenda WHERE id = ?',
        [t1.id],
      ),
    );
    expect(u).toMatchObject({ s: 'pendente', h: hashTextoAgenda(novo), hb: hashTextoAgenda(novo) });
    expect(Number(u!['n'])).toBe(novo.length);
  });

  it('aceite (resposta 6 da Hal-AI, dados sintéticos): valor, convênio e subplano, preparo e idade, com o texto ao lado', async () => {
    const t = await escrever((e) =>
      gravarTextoOrigemAgenda(
        e,
        { agendaId: ids.agenda, fontePagadoraId: null, campo: 'observacao', texto: TEXTO },
        null,
      ),
    );
    await escrever(async (e) => {
      await incluirRegraPrecoParticular(
        e,
        {
          estabelecimentoId: null,
          fontePagadoraId: ids.particular,
          dono: { tipo: 'agenda', agendaId: ids.agenda },
          alvo: { tipo: 'consulta' },
          valor: 250,
          prioridade: 100,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          situacaoRevisao: 'estimada',
          textoOrigemId: t.id,
          observacao: null,
        },
        null,
      );
      for (const [plano, aceita] of [
        [ids.ouro, true],
        [ids.bronze, false],
      ] as const)
        await incluirCoberturaAgenda(
          e,
          {
            agendaId: ids.agenda,
            fontePagadoraId: ids.convenio,
            planoId: plano,
            aceita,
            observacao: null,
            vigenciaInicio: '2026-01-01',
            vigenciaFim: null,
            situacaoRevisao: 'estimada',
            textoOrigemId: t.id,
          },
          null,
        );
      await incluirRestricaoAgenda(
        e,
        {
          agendaId: ids.agenda,
          fontePagadoraId: null,
          planoId: null,
          itemAgendavelId: null,
          sexoAtendido: null,
          idadeMinimaAnos: 12,
          idadeMaximaAnos: null,
          aceitaRetorno: null,
          diasRetorno: null,
          permiteEncaixe: null,
          observacao: null,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          situacaoRevisao: 'estimada',
          textoOrigemId: t.id,
        },
        null,
      );
      await incluirPreparoAgenda(
        e,
        {
          agendaId: ids.agenda,
          itemAgendavelId: null,
          tipo: 'documento',
          descricao: 'Trazer pedido médico',
          jejumHoras: null,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          situacaoRevisao: 'confirmada',
          textoOrigemId: null,
        },
        null,
      );
    });
    const a = esquemaAgendaEstruturada.parse(await ler((l) => lerAgendaEstruturada(l, ids.agenda, DIA)));
    // "quanto custa a consulta particular com o médico X": a regra da agenda (250, estimada) e a do médico (300)
    expect(a.precosParticulares.map((r) => r.valor).sort()).toEqual([250, 300]);
    // "o médico atende o meu convênio, plano ouro? e bronze?": ouro aceita, bronze exclui; ambos subplanos
    const cob = new Map(a.coberturas.map((c) => [c.planoId, c]));
    expect(cob.get(ids.ouro)?.aceita).toBe(true);
    expect(cob.get(ids.bronze)?.aceita).toBe(false);
    expect(cob.get(ids.ouro)?.planoSuperiorId).not.toBeNull();
    expect(a.convenios).toContain(ids.convenio);
    // "precisa de preparo?": só o documento (o jejum estimado saiu quando o texto mudou)
    expect(a.preparos.map((p) => p.descricao)).toEqual(['Trazer pedido médico']);
    // "atende criança de 5 anos?": restrição de 12 anos
    expect(a.restricoes[0]?.idadeMinimaAnos).toBe(12);
    // o texto original vem ao lado, íntegro, e a agenda tem o código de origem
    expect(a.textos[0]?.texto).toBe(TEXTO);
    expect(a.codigoOrigem).toBe('9001');
  });

  it('nomes: credenciamento e agenda estruturada trazem profissional, convênio, plano e estabelecimento', async () => {
    const [c] = await ler((l) =>
      credenciamentosVigentes(l, {
        profissionalId: ids.prof2,
        fontePagadoraId: ids.convenio,
        estabelecimentoId: ids.est,
        data: DIA,
      }),
    );
    expect(c).toMatchObject({ profissionalNome: 'a9m Medico Y', fontePagadoraNome: 'a9mconv' });
    expect(c?.estabelecimentoNome ?? null).toBe(c?.estabelecimentoId === null ? null : 'a9m Hospital');
    const a = esquemaAgendaEstruturada.parse(await ler((l) => lerAgendaEstruturada(l, ids.agenda, DIA)));
    expect([a.profissionalNome, a.estabelecimentoId, a.estabelecimentoNome]).toEqual([
      'a9m Medico X',
      ids.est,
      'a9m Hospital',
    ]);
    expect(a.conveniosAceitos.map((v) => v.nome).sort()).toEqual(['a9mconv', 'a9mpart']);
    const ouro = a.coberturas.find((x) => x.planoId === ids.ouro);
    expect([ouro?.fontePagadoraNome, ouro?.planoNome, ouro?.planoSuperiorNome]).toEqual([
      'a9mconv',
      'a9mouro',
      'a9mraiz',
    ]);
    expect(a.restricoes[0]).toMatchObject({ fontePagadoraNome: null, planoNome: null });
  });

  it('valor de consulta da origem: espera a classificação; particular vira regra, convênio é descartado', async () => {
    const r = await escrever(async (e) => {
      const outra = await e.inserir(
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('a9moutro', 'a9moutro', 'outro', CURRENT_TIMESTAMP(3))`,
      );
      const origem = (fonte: number, valor: number) =>
        e.inserir(
          `INSERT INTO preco_consulta_origem (fonte_pagadora_id, profissional_id, valor, vigencia_inicio) VALUES (?, ?, ?, ?)`,
          [fonte, ids.prof2, valor, '2026-01-01'],
        );
      await origem(ids.particular, 220);
      await origem(outra, 90);
      // CHECK: aplicada sem regra recusa
      await expect(
        e.executar("UPDATE preco_consulta_origem SET situacao = 'aplicada' WHERE fonte_pagadora_id = ?", [
          outra,
        ]),
      ).rejects.toThrow();
      const semTipo = await aplicarPrecosConsultaOrigem(e, outra, null);
      await e.executar("UPDATE fonte_pagadora SET tipo = 'operadora' WHERE id = ?", [outra]);
      const convenio = await aplicarPrecosConsultaOrigem(e, outra, null);
      const particular = await aplicarPrecosConsultaOrigem(e, ids.particular, null);
      const denovo = await aplicarPrecosConsultaOrigem(e, ids.particular, null);
      const linhas = await e.consultar(
        `SELECT o.situacao, o.regra_preco_particular_id IS NOT NULL AS com_regra FROM preco_consulta_origem o
          JOIN fonte_pagadora f ON f.id = o.fonte_pagadora_id WHERE f.codigo LIKE 'a9m%' ORDER BY o.valor`,
      );
      return { semTipo, convenio, particular, denovo, linhas };
    });
    expect(r.semTipo).toEqual({ aplicadas: 0, descartadas: 0 });
    expect(r.convenio).toEqual({ aplicadas: 0, descartadas: 1 });
    expect(r.particular).toEqual({ aplicadas: 1, descartadas: 0 });
    expect(r.denovo).toEqual({ aplicadas: 0, descartadas: 0 });
    expect(r.linhas.map((x) => [x['situacao'], Number(x['com_regra'])])).toEqual([
      ['descartada', 0],
      ['aplicada', 1],
    ]);
    const regras = await ler((l) => listarRegrasPrecoParticular(l, { profissionalId: ids.prof2 }));
    expect(regras.map((x) => [x.alvo.tipo, x.valor, x.origem])).toEqual([['consulta', 220, 'migracao']]);
  });
});
