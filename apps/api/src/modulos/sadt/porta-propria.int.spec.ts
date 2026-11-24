// Integração da porta própria do SADT contra o MariaDB real (cliente de teste do lote, SGH_CLIENTE_TESTE; massa SINTÉTICA, nenhuma pessoa real).
// Leituras: a lista do setor com filtro e contagens, o exame e o estado derivado, o isolamento por estabelecimento, os
// analitos do exame e a liberação vigente. Contrato de efeito: o laudo emitido (emissão, exames, número de negócio, o
// item marcado como emitido e a trilha), a validação pública pelo código, a segunda via com motivo e a leitura do
// resultado registrada. F2.4: bancada, recepção do setor, apoio, parâmetros, indicadores, orçamento e conversão, portal
// (laudos, laudo aberto, leitura no portal) e autocadastro com a decisão. O que falta no modelo responde 409 com o motivo.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import type { Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { garantir } from '../enfermagem/massa-enfermagem.spec-util.js';
import { chaveAcessoPortal, PortaSadtPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)(`porta própria do SADT (MariaDB, cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s09por' }, (l) => l.uma(sql, p));
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s09por' }, fn);
  // O que os testes da F2.4 montam fora da massa comum (apagado antes dela).
  let orcamento: number | null = null;
  let publicacao: number | null = null;
  let pedidos: readonly [number, number] | null = null;
  let inscricao: number | null = null;
  let autocadastro: number | null = null;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9P');
    porta = new PortaSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await escrever(async (e) => {
      if (publicacao) {
        await e.executar('DELETE FROM acesso_resultado_portal WHERE liberacao_resultado_portal_id = ?', [
          publicacao,
        ]);
        await e.executar('DELETE FROM liberacao_resultado_portal WHERE id = ?', [publicacao]);
      }
      if (orcamento) {
        await e.executar('DELETE FROM orcamento_particular_item WHERE orcamento_particular_id = ?', [
          orcamento,
        ]);
        await e.executar('DELETE FROM orcamento_particular WHERE id = ?', [orcamento]);
      }
      if (pedidos) {
        await e.executar(
          `UPDATE pedido_vinculo_profissional_externo SET conta_portal_profissional_externo_id = NULL WHERE id IN (?, ?)`,
          [...pedidos],
        );
        await e.executar(
          'DELETE FROM conta_portal_profissional_externo WHERE pedido_vinculo_profissional_externo_id IN (?, ?)',
          [...pedidos],
        );
        await e.executar('DELETE FROM pedido_vinculo_profissional_externo WHERE id IN (?, ?)', [...pedidos]);
      }
      if (inscricao) await e.executar('DELETE FROM inscricao_conselho WHERE id = ?', [inscricao]);
      if (autocadastro)
        await e.executar('DELETE FROM pedido_vinculo_profissional_externo WHERE id = ?', [autocadastro]);
      await e.executar('DELETE FROM protocolo_acesso_portal WHERE atendimento_id = ?', [
        m?.base.atendimento ?? 0,
      ]);
    });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('lista do setor, filtros, contagens, exame e isolamento por estabelecimento', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const lab = await porta.examesDoSetor(c, { setor: 'laboratorio', inicio: hoje, fim: hoje });
    expect(lab.itens.map((x) => x.id).sort()).toEqual([m!.itemLab, m!.itemLab2, m!.itemLiberado].sort());
    expect(lab.contagens).toMatchObject({ solicitado: 2, liberado: 1 });
    const aReceber = await porta.examesDoSetor(c, {
      setor: 'laboratorio',
      inicio: hoje,
      fim: hoje,
      situacao: 'aReceber',
    });
    expect(aReceber.itens).toHaveLength(2);
    const imagem = await porta.examesDoSetor(c, { setor: 'imagem', inicio: hoje, fim: hoje, ato: 25 });
    expect(imagem.itens.map((x) => x.id)).toEqual([m!.itemImagem]);
    expect(imagem.itens[0]).toMatchObject({ setor: 'imagem', ato: 25, exame: { codigo: `${m!.marca}T` } });
    const x = await porta.exame(c, m!.itemLiberado);
    expect(x).toMatchObject({
      estado: 'liberado',
      critico: true,
      origem: 'pedidoProntuario',
      paciente: { id: m!.base.paciente },
      chave: { conta: m!.requisicao, sequencia: 3, ato: 15 },
    });
    expect(x!.versao).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(await porta.exame(contexto(m!, m!.base.outroEst), m!.itemLab)).toBeNull();
    expect(await porta.elementos(c, m!.exameLabCodigo)).toEqual([
      { codigo: m!.analito, nome: 'POTASSIO', unidade: null },
    ]);
    expect(await porta.liberacaoVigente(c, m!.itemLiberado)).toMatchObject({
      id: m!.resultado,
      visualizada: false,
    });
    expect(await porta.liberacaoVigente(c, m!.itemLab)).toBeNull();
    expect(await porta.pacienteDoAtendimento(c, m!.base.atendimento)).toMatchObject({
      paciente: m!.base.paciente,
    });
    const coleta = await porta.coleta(c, { inicio: hoje, fim: hoje });
    expect(coleta.grupos).toHaveLength(1);
    expect(coleta.grupos[0]!.exames).toHaveLength(2);
  });

  it('laudo emitido, validação pública, segunda via com motivo e leitura do resultado', async () => {
    const c = contexto(m!);
    // Os mesmos passos e argumentos do ServicoSadt.emitirLaudo, numa transação: o número reservado antes do PDF (a 1ª
    // via) ou o da 1ª (a via seguinte), com o MESMO código de autenticação e a emissão original.
    const cod1 = `${m!.marca}A1B2C3D4E5`.slice(0, 16);
    const emitir = async (motivo: string | null, falharDepois = false) => {
      const anterior = await porta.impressaoDosExames(c, [m!.itemLiberado]);
      return porta.gravarSgh(
        c,
        (r: { id: number }) => linhaTela(m!, 'sadt.laudo.emitido', 'emissao_laudo', r.id),
        async (g) => {
          const numero = anterior?.numero ?? (await g.reservarNumeroLaudo());
          // A falha do PDF (ou de outra gravação) depois da reserva desfaz tudo, inclusive o número.
          if (falharDepois) throw new Error('pdf-falhou');
          return g.registrarLaudoEmitido({
            impressao: anterior?.impressao ?? 0,
            numero,
            original: anterior?.impressao ?? null,
            codigo: anterior?.codigo ?? cod1,
            via: anterior ? anterior.vias + 1 : 1,
            exames: 1,
            hashPdf: null,
            motivo,
            usuario: m!.base.login,
            idsExames: [m!.itemLiberado],
          });
        },
      );
    };
    const valor = (t: string) => Number(/(\d+)$/.exec(t)?.[1]);
    // Sem lacuna: a emissão desfeita depois da reserva devolve o número, e a seguinte usa o mesmo valor.
    const espiado = await escrever(async (e) =>
      e.uma(
        "SELECT proximo_valor FROM sequencia_negocio WHERE tipo = 'laudo_exame' AND estabelecimento_id = ?",
        [m!.base.est],
      ),
    );
    // A porta devolve a falha inesperada como erro interno; o que importa é a transação desfeita.
    await expect(emitir(null, true)).rejects.toBeDefined();
    const { id, numero } = await emitir(null);
    expect(valor(numero)).toBe(Number(espiado?.['proximo_valor']));
    expect(
      await um(
        'SELECT numero, tipo_emissao, numero_via, emissao_original_id, versao FROM emissao_laudo WHERE id = ?',
        [id],
      ),
    ).toMatchObject({ numero, tipo_emissao: 'pdf', numero_via: 1, emissao_original_id: null, versao: 1 });
    expect(
      await um('SELECT emitido_em IS NOT NULL AS e, versao FROM exame_item WHERE id = ?', [m!.itemLiberado]),
    ).toMatchObject({
      e: 1,
      versao: 2,
    });
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'emissao_laudo' AND entidade_id = ?",
            [id],
          )
        )?.['n'],
      ),
    ).toBe(1);
    expect(await porta.validarLaudo(c, cod1)).toMatchObject({ valido: true, numero, exames: 1 });
    expect(await porta.validarLaudo(c, 'NAOEXISTE')).toMatchObject({ valido: false, numero: null });
    expect(await porta.impressaoDosExames(c, [m!.itemLiberado])).toMatchObject({
      impressao: id,
      numero,
      codigo: cod1,
      vias: 1,
    });
    expect(codigoDe(await emitir(null).catch((e: unknown) => e))).toBe('motivo-obrigatorio');
    expect(codigoDe(await emitir('motivo livre qualquer').catch((e: unknown) => e))).toBe(
      'motivo-nao-cadastrado',
    );
    // A 2ª e a 3ª via: o MESMO laudo (número e código da 1ª), com a via e a emissão original; nenhum número novo.
    const via2 = await emitir('Paciente perdeu a primeira via');
    const via3 = await emitir('Paciente perdeu a primeira via');
    expect([via2.numero, via3.numero]).toEqual([numero, numero]);
    expect(
      await um(
        `SELECT COUNT(*) AS n, MAX(numero_via) AS v, CAST(SUM(codigo_autenticacao = ?) AS SIGNED) AS mesmo,
                CAST(SUM(tipo_emissao = 'reimpressao' AND motivo_reimpressao_id IS NOT NULL) AS SIGNED) AS motivadas
           FROM emissao_laudo WHERE emissao_original_id = ?`,
        [cod1, id],
      ),
    ).toMatchObject({ n: 2, v: 3, mesmo: 2, motivadas: 2 });
    const depois = await escrever(async (e) =>
      e.uma(
        "SELECT proximo_valor FROM sequencia_negocio WHERE tipo = 'laudo_exame' AND estabelecimento_id = ?",
        [m!.base.est],
      ),
    );
    expect(Number(depois?.['proximo_valor'])).toBe(valor(numero) + 1);
    expect(await porta.validarLaudo(c, cod1)).toMatchObject({ valido: true, numero });
    expect(await porta.laudosDoExame(c, m!.itemLiberado)).toMatchObject([
      { numero, codigo: cod1, segundasVias: 2 },
    ]);
    expect((await porta.exame(c, m!.itemLiberado))?.estado).toBe('emitido');

    const ler = (origem: 'pep' | 'portal') =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.resultado.lido', 'visualizacao_resultado_exame', null), (g) =>
        g.registrarLeitura({ exameItem: m!.itemLiberado, origem, usuario: m!.base.login }),
      );
    await ler('pep');
    // A segunda abertura do mesmo usuário não grava de novo (nem estoura a chave única).
    await ler('pep');
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM visualizacao_resultado_exame WHERE resultado_exame_id = ?', [
            m!.resultado,
          ])
        )?.['n'],
      ),
    ).toBe(1);
    // A leitura no portal vai à publicação do resultado no portal: sem publicação, recusa explícita.
    expect(codigoDe(await ler('portal').catch((x: unknown) => x))).toBe('resultado-nao-publicado');
    expect(await porta.liberacaoVigente(c, m!.itemLiberado)).toMatchObject({ visualizada: true });
    expect((await porta.exame(c, m!.itemLiberado))?.estado).toBe('visualizado');
  });

  it('aviso de valor crítico: um por analito, regra da unidade antes da rede, prazo da regra, sem repetir', async () => {
    const c = contexto(m!);
    const { r2, r3, regraUnidade, regraExame } = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 't-s09crit' },
      async (e) => {
        const resultado = (item: number) =>
          e.inserir(
            `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, forma_entrada, situacao,
             numero_versao, resultado_em, liberado_em, liberado_por_profissional_id, critico, criado_em, versao)
           VALUES (?, ?, ?, 'interface', 'liberado', 1, NOW(), NOW(), ?, TRUE, NOW(), 1)`,
            [item, m!.base.paciente, m!.setorLab, m!.base.profissional],
          );
        const regra = (estab: number | null, analito: number | null, prazo: number) =>
          e.inserir(
            `INSERT INTO regra_valor_critico (estabelecimento_id, analito_id, exame_id, limite_superior,
             prazo_comunicacao_minutos, vigencia_inicio, ativo, criado_em, versao)
           VALUES (?, ?, ?, 6.5, ?, DATE_SUB(CURDATE(), INTERVAL 1 DAY), TRUE, NOW(), 1)`,
            [estab, analito, m!.exameLab, prazo],
          );
        const r2 = await resultado(m!.itemLab2);
        await e.inserir(
          `INSERT INTO resultado_analito (resultado_exame_id, sequencia, analito_id, valor_numerico, critico, criado_em, versao)
         VALUES (?, 1, ?, 7.4, TRUE, NOW(), 1)`,
          [r2, m!.analito],
        );
        const r3 = await resultado(m!.itemLab);
        await regra(null, m!.analito, 40);
        const regraUnidade = await regra(m!.base.est, m!.analito, 12);
        const regraExame = await regra(m!.base.est, null, 20);
        return { r2, r3, regraUnidade, regraExame };
      },
    );
    const avisar = (item: number, id: number) =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.critico.avisado', 'aviso_valor_critico', null), (g) =>
        g.avisarCriticos({
          exameItem: item,
          chave: `${m!.marca}-${id}`,
          idLiberacao: id,
          liberadoEm: new Date(),
          paciente: m!.base.paciente,
          atendimento: m!.base.atendimento,
        }),
      );
    const aviso = (id: number) =>
      um(
        `SELECT COUNT(*) AS n, MAX(regra_valor_critico_id) AS regra, MAX(resultado_analito_id) AS ra,
                MAX(TIMESTAMPDIFF(SECOND, gerado_em, prazo_em)) AS s
           FROM aviso_valor_critico WHERE resultado_exame_id = ?`,
        [id],
      );
    // Analito crítico: a regra do analito na unidade vence a da rede e a do exame; prazo_em = gerado_em + 12 min.
    expect(await avisar(m!.itemLab2, r2)).toBe(1);
    const a2 = await aviso(r2);
    expect([Number(a2?.['n']), Number(a2?.['regra']), Number(a2?.['s'])]).toEqual([1, regraUnidade, 12 * 60]);
    expect(a2?.['ra']).not.toBeNull();
    // Avisar de novo o mesmo resultado não repete.
    expect(await avisar(m!.itemLab2, r2)).toBe(0);
    expect(Number((await aviso(r2))?.['n'])).toBe(1);
    // Crítico do exame sem analito: só a regra do exame vale (prazo 20); o aviso não tem analito.
    expect(await avisar(m!.itemLab, r3)).toBe(1);
    const a3 = await aviso(r3);
    expect([Number(a3?.['n']), Number(a3?.['regra']), Number(a3?.['s']), a3?.['ra']]).toEqual([
      1,
      regraExame,
      20 * 60,
      null,
    ]);
  });

  it('bancada: digitação, conferência, fila de liberação e laudo para emitir', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const d = await porta.digitacao(c, m!.itemLiberado);
    expect(d?.exame.id).toBe(m!.itemLiberado);
    expect(d?.elementos.map((x) => [x.codigo, x.nome, x.valor?.numerico ?? null])).toEqual([
      [m!.analito, 'POTASSIO', expect.any(Number)],
    ]);
    expect(d?.bloqueado).toBe(true);
    expect(await porta.digitacao(contexto(m!, m!.base.outroEst), m!.itemLiberado)).toBeNull();
    const conf = await porta.conferencia(c, m!.itemLiberado);
    expect(conf).toMatchObject({ critico: true, versoes: [] });
    expect(conf!.valores).toHaveLength(1);
    expect(conf!.valores[0]).toMatchObject({ elemento: 'POTASSIO', critico: true });
    // O exame digitado entra na fila de liberação do setor (com o resultado; sem ele, sem valores).
    await escrever((e) =>
      e.executar("UPDATE exame_item SET situacao = 'resultado_digitado' WHERE id = ?", [m!.itemLab2]),
    );
    const fila = await porta.filaLiberacao(c, { setor: 'laboratorio', inicio: hoje, fim: hoje });
    expect(fila.itens.map((x) => x.exame.id)).toEqual([m!.itemLab2]);
    const laudo = await porta.laudoParaEmitir(c, [m!.itemLiberado]);
    expect(laudo).toMatchObject({
      paciente: { id: m!.base.paciente },
      exames: [{ id: m!.itemLiberado, setor: 'Laboratório' }],
    });
    expect(laudo!.exames[0]!.valores).toHaveLength(1);
    expect(await porta.laudoParaEmitir(c, [m!.itemLiberado, m!.itemImagem + 999_999])).toBeNull();
  });

  it('laudo para emitir: laudo em rascunho não sai impresso (recusa); assinado sai com o laudista', async () => {
    const c = contexto(m!);
    const laudo = await escrever(async (e) =>
      Number(
        await e.inserir(
          `INSERT INTO laudo_diagnostico (estabelecimento_id, exame_item_id, paciente_id, setor_diagnostico_id, texto,
             laudista_profissional_id, situacao, criado_em, versao)
           VALUES (?, ?, ?, ?, 'TEXTO SINTETICO DO LAUDO', ?, 'rascunho', NOW(3), 1)`,
          [m!.base.est, m!.itemLiberado, m!.base.paciente, m!.setorLab, m!.base.profissional],
        ),
      ),
    );
    try {
      for (const situacao of ['rascunho', 'aguardando_revisao']) {
        await escrever((e) =>
          e.executar('UPDATE laudo_diagnostico SET situacao = ? WHERE id = ?', [situacao, laudo]),
        );
        expect(codigoDe(await porta.laudoParaEmitir(c, [m!.itemLiberado]).catch((x: unknown) => x))).toBe(
          'laudo-nao-assinado',
        );
      }
      await escrever((e) =>
        e.executar("UPDATE laudo_diagnostico SET situacao = 'assinado', assinado_em = NOW(3) WHERE id = ?", [
          laudo,
        ]),
      );
      const ok = await porta.laudoParaEmitir(c, [m!.itemLiberado]);
      expect(ok!.exames[0]!.texto[0]).toBe('TEXTO SINTETICO DO LAUDO');
      expect(ok!.exames[0]!.emissor).not.toBe('');
      // Cancelado não conta: volta ao texto do resultado, sem laudista.
      await escrever((e) =>
        e.executar("UPDATE laudo_diagnostico SET situacao = 'cancelado' WHERE id = ?", [laudo]),
      );
      const sem = await porta.laudoParaEmitir(c, [m!.itemLiberado]);
      expect(sem!.exames[0]!.texto).not.toContain('TEXTO SINTETICO DO LAUDO');
      expect(sem!.exames[0]!.emissor).toBe('');
    } finally {
      await escrever((e) => e.executar('DELETE FROM laudo_diagnostico WHERE id = ?', [laudo]));
    }
  });

  it('digitação: a faixa de referência específica por idade vence a geral mais recente', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const ea = Number(
      (
        await um('SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ?', [
          m!.exameLab,
          m!.analito,
        ])
      )?.['id'],
    );
    const faixas = await escrever(async (e) => {
      const ins = (min: number | null, max: number | null, rmin: number, rmax: number, dias: number) =>
        e.inserir(
          `INSERT INTO faixa_referencia (exame_analito_id, idade_minima_dias, idade_maxima_dias, referencia_minima, referencia_maxima,
             vigencia_inicio, ativo, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, DATE_SUB(?, INTERVAL ? DAY), TRUE, NOW(3), 1)`,
          [ea, min, max, rmin, rmax, hoje, dias],
        );
      // A geral (sem idade), mais recente; a do adulto (o paciente sintético tem mais de 18 anos), mais antiga; e a
      // pediátrica, que não vale para ele.
      return [
        await ins(null, null, 1, 2, 0),
        await ins(6570, null, 3, 4, 365),
        await ins(0, 6569, 5, 6, 10),
      ].map(Number);
    });
    try {
      const d = await porta.digitacao(c, m!.itemLab2);
      expect(d?.elementos[0]?.referencia).toMatchObject({ minimo: 3, maximo: 4 });
    } finally {
      await escrever((e) => e.executar(`DELETE FROM faixa_referencia WHERE id IN (?, ?, ?)`, faixas));
    }
  });

  it('recepção do setor, catálogo de apoio, parâmetros e indicadores', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const at = await porta.atendimento(c, m!.base.atendimento);
    expect(at).toMatchObject({
      atendimento: m!.base.atendimento,
      reg: m!.base.atendimento,
      paciente: { id: m!.base.paciente },
    });
    expect(at!.retratos).toMatchObject({ htAtendimento: expect.any(Number), htPaciente: expect.any(Number) });
    expect(await porta.atendimento(contexto(m!, m!.base.outroEst), m!.base.atendimento)).toBeNull();
    expect((await porta.atendimentosPorNumero(c, m!.base.atendimento)).map((x) => x.atendimento)).toContain(
      m!.base.atendimento,
    );
    const entrada = String(
      (
        await um("SELECT DATE_FORMAT(entrada_em, '%Y-%m-%d') AS d FROM atendimento WHERE id = ?", [
          m!.base.atendimento,
        ])
      )?.['d'],
    );
    const req = await porta.requisicoes(c, { data: entrada });
    const linha = req.itens.find((x) => x.reg === m!.base.atendimento);
    expect(linha?.exames).toBeGreaterThanOrEqual(3);
    const apoio = await porta.apoio(c, 'laboratorio');
    expect(apoio.prestadores.map((x) => x.id)).toContain(m!.setorLab);
    expect(apoio.prestadores.map((x) => x.id)).not.toContain(m!.setorImagem);
    expect(apoio.exames.find((x) => x.id === m!.exameLab)).toMatchObject({
      ato: 15,
      codigo: m!.exameLabCodigo,
    });
    const par = await porta.parametros(c, 'laboratorio', m!.base.login);
    expect(par.ocultos).toEqual([]);
    expect(par.campos.every((x) => x.campo.startsWith('sadt.'))).toBe(true);
    // 05-SADT linha 25 (migração 10_SADT/97): as definições semeadas, com o padrão; só as do próprio setor.
    const campo = (k: string) => par.campos.find((x) => x.campo === k)?.valor;
    expect(campo('sadt.laboratorio.numeracaoExame')).toBe('continua');
    expect(campo('sadt.laboratorio.exigeMaterial')).toBe('true');
    expect(campo('sadt.laboratorio.viasLaudo')).toBe('1');
    expect(campo('sadt.validadeOrcamentoDias')).toBe('30');
    expect(par.campos.some((x) => x.campo.startsWith('sadt.imagem.'))).toBe(false);
    expect((await porta.parametros(c, 'imagem', m!.base.login)).campos.map((x) => x.campo)).toContain(
      'sadt.imagem.exigeMaterial',
    );
    const ind = await porta.indicadores(c, {
      inicio: hoje,
      fim: hoje,
      setor: 'laboratorio',
      agora: new Date(),
    });
    const lab = ind.linhas.filter((x) => x.setor === 'laboratorio');
    expect(lab.reduce((s, x) => s + x.exames, 0)).toBe(3);
    expect(lab.reduce((s, x) => s + x.liberados, 0)).toBe(1);
    expect(ind.porDia).toEqual([{ dia: hoje, exames: 3 }]);
    expect(ind.visualizadosPortal.liberados).toBe(1);
  });

  it('orçamento do diagnóstico: lista, leitura e conversão no atendimento (uma vez só)', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    orcamento = await escrever(async (e) => {
      const fonte = (
        await e.uma<{ f: number }>('SELECT fonte_pagadora_id AS f FROM atendimento WHERE id = ?', [
          m!.base.atendimento,
        ])
      )?.f;
      const id = await e.inserir(
        `INSERT INTO orcamento_particular (estabelecimento_id, numero, paciente_id, fonte_pagadora_id, data_orcamento, validade_ate,
           valor_bruto, valor_total, situacao, criado_em, versao)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 30 DAY), 50, 50, 'emitido', NOW(3), 1)`,
        [m!.base.est, `${m!.marca}O1`, m!.base.paciente, fonte, hoje, hoje],
      );
      await e.inserir(
        `INSERT INTO orcamento_particular_item (orcamento_particular_id, sequencia, tipo_item, descricao, valor_unitario, valor_total, criado_em, versao)
         VALUES (?, 1, 'exame', ?, 50, 50, NOW(3), 1)`,
        [id, m!.exameLabCodigo],
      );
      return Number(id);
    });
    const lista = await porta.orcamentos(c, { inicio: hoje, fim: hoje, hoje, validadeDias: 30 });
    expect(lista.itens.find((x) => x.id === orcamento)).toMatchObject({
      ato: 15,
      situacao: 'aberto',
      total: 50,
      itens: [{ exame: m!.exameLabCodigo, valor: 50 }],
      convertidoEm: null,
    });
    expect((await porta.orcamento(c, orcamento!, { hoje, validadeDias: 30 }))?.nomeRegistrado).not.toBe('');
    expect(
      await porta.orcamento(contexto(m!, m!.base.outroEst), orcamento!, { hoje, validadeDias: 30 }),
    ).toBeNull();
    const converter = () =>
      porta.gravarSgh(
        c,
        linhaTela(m!, 'sadt.orcamento.convertido', 'orcamento_particular', orcamento!),
        (g) =>
          g.marcarOrcamentoConvertido({
            orcamento: orcamento!,
            atendimento: m!.base.atendimento,
            usuario: m!.base.login,
          }),
      );
    await converter();
    expect(await porta.orcamento(c, orcamento!, { hoje, validadeDias: 30 })).toMatchObject({
      situacao: 'convertido',
      convertidoEm: { atendimento: m!.base.atendimento, em: hoje },
    });
    expect(codigoDe(await converter().catch((x: unknown) => x))).toBe('orcamento-convertido');
  });

  it('orçamento: vencido pela data e sem exame não convertem; rascunho converte; item sem exame não some', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const ids: number[] = [];
    const criar = (
      sufixo: string,
      situacao: string,
      validadeDias: number,
      itens: [string, string, number][],
    ) =>
      escrever(async (e) => {
        const fonte = (
          await e.uma<{ f: number }>('SELECT fonte_pagadora_id AS f FROM atendimento WHERE id = ?', [
            m!.base.atendimento,
          ])
        )?.f;
        const total = itens.reduce((a, [, , v]) => a + v, 0);
        const id = Number(
          await e.inserir(
            `INSERT INTO orcamento_particular (estabelecimento_id, numero, paciente_id, fonte_pagadora_id, data_orcamento, validade_ate,
               valor_bruto, valor_total, situacao, criado_em, versao)
             VALUES (?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), DATE_ADD(?, INTERVAL ? DAY), ?, ?, ?, NOW(3), 1)`,
            [
              m!.base.est,
              `${m!.marca}${sufixo}`,
              m!.base.paciente,
              fonte,
              hoje,
              Math.min(validadeDias, 0),
              hoje,
              validadeDias,
              total,
              total,
              situacao,
            ],
          ),
        );
        ids.push(id);
        let seq = 1;
        for (const [tipo, descricao, valor] of itens)
          await e.inserir(
            `INSERT INTO orcamento_particular_item (orcamento_particular_id, sequencia, tipo_item, descricao, valor_unitario, valor_total, criado_em, versao)
             VALUES (?, ?, ?, ?, ?, ?, NOW(3), 1)`,
            [id, seq++, tipo, descricao, valor, valor],
          );
        return id;
      });
    const converter = (orcamento: number) =>
      porta
        .gravarSgh(c, linhaTela(m!, 'sadt.orcamento.convertido', 'orcamento_particular', orcamento), (g) =>
          g.marcarOrcamentoConvertido({
            orcamento,
            atendimento: m!.base.atendimento,
            usuario: m!.base.login,
          }),
        )
        .then(() => 'ok')
        .catch((x: unknown) => codigoDe(x));
    try {
      const vencido = await criar('O2', 'emitido', -1, [['exame', m!.exameLabCodigo, 50]]);
      const semExame = await criar('O3', 'emitido', 30, [['procedimento', 'PROCEDIMENTO SINTETICO', 80]]);
      const rascunho = await criar('O4', 'rascunho', 0, [
        ['exame', m!.exameLabCodigo, 50],
        ['exame', 'EXAME SINTETICO SEM CADASTRO', 20],
      ]);
      expect(await porta.orcamento(c, vencido, { hoje, validadeDias: 30 })).toMatchObject({
        situacao: 'vencido',
      });
      expect(await converter(vencido)).toBe('orcamento-indisponivel');
      expect(await converter(semExame)).toBe('orcamento-inexistente');
      // O item que não casa com exame continua na lista (sem código), e a soma dos itens bate com o total.
      const r = await porta.orcamento(c, rascunho, { hoje, validadeDias: 30 });
      expect(r).toMatchObject({
        ato: 15,
        situacao: 'aberto',
        total: 70,
        itens: [
          { exame: m!.exameLabCodigo, valor: 50 },
          { exame: '', nome: 'EXAME SINTETICO SEM CADASTRO', valor: 20 },
        ],
      });
      // Validade igual a hoje ainda vale; o rascunho converte (a conversão registra o aceite).
      expect(await converter(rascunho)).toBe('ok');
      expect(
        await um('SELECT situacao, aceito_em IS NOT NULL AS aceito FROM orcamento_particular WHERE id = ?', [
          rascunho,
        ]),
      ).toMatchObject({
        situacao: 'realizado',
        aceito: 1,
      });
    } finally {
      await escrever(async (e) => {
        for (const id of ids) {
          await e.executar('DELETE FROM orcamento_particular_item WHERE orcamento_particular_id = ?', [id]);
          await e.executar('DELETE FROM orcamento_particular WHERE id = ?', [id]);
        }
      });
    }
  });

  it('portal: laudos publicados do paciente e do médico, laudo aberto e a leitura no portal (uma vez)', async () => {
    const c = contexto(m!);
    publicacao = await escrever(async (e) =>
      Number(
        await e.inserir(
          `INSERT INTO liberacao_resultado_portal (estabelecimento_id, resultado_exame_id, paciente_id, liberado_em, situacao, criado_em, versao)
           VALUES (?, ?, ?, DATE_SUB(NOW(3), INTERVAL 1 MINUTE), 'liberado', NOW(3), 1)`,
          [m!.base.est, m!.resultado, m!.base.paciente],
        ),
      ),
    );
    const doPaciente = await porta.laudosPortalDoPaciente(c, {
      paciente: m!.base.paciente,
      reg: null,
      atos: [15],
    });
    expect(doPaciente.laudos).toEqual([
      expect.objectContaining({
        liberacao: publicacao,
        exame: m!.itemLiberado,
        visualizado: false,
        paciente: null,
      }),
    ]);
    expect(
      (await porta.laudosPortalDoPaciente(c, { paciente: m!.base.paciente, reg: null, atos: [25] })).laudos,
    ).toEqual([]);
    const sol = Number(
      (
        await um('SELECT solicitante_profissional_id AS s FROM requisicao_exame WHERE id = ?', [
          m!.requisicao,
        ])
      )?.['s'],
    );
    const doMedico = await porta.laudosPortalDoMedico(c, {
      solicitante: sol,
      atos: [15],
      desde: '2000-01-01',
    });
    expect(doMedico.laudos.map((x) => x.liberacao)).toEqual([publicacao]);
    const aberto = await porta.laudoPortal(c, publicacao!);
    expect(aberto).toMatchObject({ ato: 15, paciente: m!.base.paciente, solicitante: sol });
    expect(aberto!.valores).toHaveLength(1);
    expect(await porta.laudoPortal(contexto(m!, m!.base.outroEst), publicacao!)).toBeNull();
    const ler = () =>
      porta.gravarSgh(
        c,
        linhaTela(m!, 'sadt.resultado.lido', 'liberacao_resultado_portal', publicacao!),
        (g) => g.registrarLeitura({ exameItem: m!.itemLiberado, origem: 'portal', usuario: 'portal' }),
      );
    await ler();
    const primeira = (
      await um('SELECT primeira_visualizacao_em AS p FROM liberacao_resultado_portal WHERE id = ?', [
        publicacao,
      ])
    )?.['p'];
    await ler();
    // Todo acesso fica no registro (auditoria do acesso a dado de saúde) e soma uma visualização; a primeira não muda.
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM acesso_resultado_portal WHERE liberacao_resultado_portal_id = ?',
            [publicacao],
          )
        )?.['n'],
      ),
    ).toBe(2);
    expect(
      await um(
        'SELECT visualizacoes, primeira_visualizacao_em AS p FROM liberacao_resultado_portal WHERE id = ?',
        [publicacao],
      ),
    ).toMatchObject({
      visualizacoes: 2,
      p: primeira,
    });
    expect((await porta.laudoPortal(c, publicacao!))?.laudo.visualizado).toBe(true);
    expect(
      codigoDe(
        await porta
          .gravarSgh(c, linhaTela(m!, 'sadt.resultado.lido', 'liberacao_resultado_portal', null), (g) =>
            g.registrarLeitura({ exameItem: m!.itemLab, origem: 'portal', usuario: 'portal' }),
          )
          .catch((x: unknown) => x),
      ),
    ).toBe('resultado-nao-publicado');
    // A publicação vencida (fora do prazo) não abre nem conta acesso, como a leitura a esconde.
    await escrever((e) =>
      e.executar(
        'UPDATE liberacao_resultado_portal SET disponivel_ate = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
        [publicacao],
      ),
    );
    expect(codigoDe(await ler().catch((x: unknown) => x))).toBe('resultado-nao-publicado');
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM acesso_resultado_portal WHERE liberacao_resultado_portal_id = ?',
            [publicacao],
          )
        )?.['n'],
      ),
    ).toBe(2);
  });

  it('autocadastro do médico externo: lista com candidatos, recusa e aprovação que cria a conta do portal', async () => {
    const c = contexto(m!);
    const { hoje } = await porta.relogio(c);
    const numero = `9${Date.now() % 10_000_000}`;
    pedidos = await escrever(async (e) => {
      // Catálogos públicos mínimos (o cliente de teste pode estar sem eles): o que já existe é reaproveitado.
      const agora = new Date();
      const cc = await garantir(
        e,
        'SELECT id FROM conselho_classe WHERE sigla = ?',
        ['CRM'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['06', 'CRM', 'Conselho Regional de Medicina', agora],
      );
      const pais = await garantir(
        e,
        'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
        ['BR'],
        'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)',
        ['BR', 'Brasil', agora],
      );
      const uf = await garantir(
        e,
        'SELECT id FROM unidade_federativa WHERE sigla = ?',
        ['MG'],
        'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['31', 'MG', 'Minas Gerais', pais, agora],
      );
      inscricao = Number(
        await e.inserir(
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id, numero_inscricao, criado_em, versao)
           VALUES (?, 90, ?, ?, ?, NOW(3), 1)`,
          [m!.base.profissional2, cc, uf, numero],
        ),
      );
      const pedido = async (k: number) =>
        Number(
          await e.inserir(
            `INSERT INTO pedido_vinculo_profissional_externo (estabelecimento_id, nome, cpf, email, conselho_classe_id, numero_conselho,
               conselho_unidade_federativa_id, situacao, solicitado_em, criado_em, versao)
             VALUES (?, 'MEDICO SINTETICO', '00000000000', ?, ?, ?, ?, 'pendente', NOW(3), NOW(3), 1)`,
            [m!.base.est, `${m!.marca.toLowerCase()}${k}@teste.invalido`, cc, numero, uf],
          ),
        );
      return [await pedido(1), await pedido(2)] as const;
    });
    const lidos = await porta.autocadastros(c, { desde: hoje });
    const meus = lidos.filter((x) => pedidos!.includes(x.id));
    expect(meus).toHaveLength(2);
    expect(meus[0]).toMatchObject({ situacao: 'pendente', numero, origem: 'novo' });
    expect(meus[0]!.candidatos.map((x) => x.id)).toEqual([m!.base.profissional2]);
    const decidir = (id: number, aprovar: boolean, solicitante: number | null) =>
      porta.gravarSgh(
        c,
        linhaTela(m!, 'sadt.autocadastro.decidido', 'pedido_vinculo_profissional_externo', id),
        (g) =>
          g.decidirAutocadastro({
            id,
            aprovar,
            solicitante,
            motivo: aprovar ? null : 'Inscrição não confere',
            usuario: m!.base.login,
          }),
      );
    expect(codigoDe(await decidir(pedidos![0], true, null).catch((x: unknown) => x))).toBe(
      'solicitante-obrigatorio',
    );
    expect(codigoDe(await decidir(pedidos![0], true, m!.base.profissional).catch((x: unknown) => x))).toBe(
      'solicitante-divergente',
    );
    await decidir(pedidos![0], true, m!.base.profissional2);
    await decidir(pedidos![1], false, null);
    expect(codigoDe(await decidir(pedidos![1], true, m!.base.profissional2).catch((x: unknown) => x))).toBe(
      'autocadastro-decidido',
    );
    const depois = (await porta.autocadastros(c, { desde: hoje })).filter((x) => pedidos!.includes(x.id));
    expect(depois.find((x) => x.id === pedidos![0])).toMatchObject({
      situacao: 'aprovado',
      situacaoConta: 'ativo',
    });
    expect(depois.find((x) => x.id === pedidos![1])).toMatchObject({ situacao: 'recusado' });
    const conta = await um(
      'SELECT profissional_id, situacao FROM conta_portal_profissional_externo WHERE pedido_vinculo_profissional_externo_id = ?',
      [pedidos![0]],
    );
    expect([Number(conta?.['profissional_id']), conta?.['situacao']]).toEqual([
      m!.base.profissional2,
      'ativa',
    ]);

    // Acesso do médico pela inscrição: a conta aprovada (id negativo), com o profissional ligado; a tentativa grava na conta.
    const medico = await porta.acessoDoMedico(c, { conselho: 'CRM', uf: 'MG', numero });
    expect(medico).toMatchObject({
      perfil: 'medicoExterno',
      situacao: 'ativo',
      solicitante: m!.base.profissional2,
      tentativas: 0,
    });
    expect(chaveAcessoPortal(medico!.id).tipo).toBe('conta');
    expect(
      await porta.acessoDoMedico(
        { ...c, estabelecimento: m!.base.outroEst },
        { conselho: 'CRM', uf: 'MG', numero },
      ),
    ).toBeNull();
    const bloqueio = new Date(Date.now() + 15 * 60_000);
    await porta.gravarSgh(
      c,
      linhaTela(m!, 'sadt.portal.tentativa', 'conta_portal_profissional_externo', -medico!.id),
      (g) =>
        g.registrarTentativaPortal({ id: medico!.id, tentativas: 3, bloqueadoAte: bloqueio, acertou: false }),
    );
    expect(await porta.acessoPorId(c, medico!.id)).toMatchObject({ tentativas: 3, perfil: 'medicoExterno' });

    // Autocadastro pelo portal: grava o pedido com o resumo da senha e o segredo cifrado; o repetido recusa.
    const numero2 = `8${Date.now() % 10_000_000}`;
    const cad = {
      nome: 'MEDICO SINTETICO DOIS',
      conselho: 'CRM',
      uf: 'MG',
      numero: numero2,
      cpf: '00000000191',
      email: `${m!.marca.toLowerCase()}9@teste.invalido`,
      senhaResumo: 'resumo-sintetico',
      segundoFator: 'envelope-sintetico',
    };
    autocadastro = await porta.gravarSgh(
      c,
      linhaTela(m!, 'sadt.portal.autocadastro', 'pedido_vinculo_profissional_externo', null),
      (g) => g.registrarAutocadastro(cad),
    );
    expect(
      codigoDe(
        await porta
          .gravarSgh(
            c,
            linhaTela(m!, 'sadt.portal.autocadastro', 'pedido_vinculo_profissional_externo', null),
            (g) => g.registrarAutocadastro(cad),
          )
          .catch((x: unknown) => x),
      ),
    ).toBe('autocadastro-repetido');
    const pendenteLido = await porta.acessoDoMedico(c, { conselho: 'CRM', uf: 'MG', numero: numero2 });
    expect(pendenteLido).toMatchObject({
      situacao: 'pendente',
      senhaResumo: 'resumo-sintetico',
      segundoFator: 'envelope-sintetico',
      solicitante: null,
    });
    expect(chaveAcessoPortal(pendenteLido!.id)).toEqual({ tipo: 'pedido', id: autocadastro });
    // O pedido sem conta conta as falhas e bloqueia como a conta (a senha dele passa à conta na aprovação).
    expect(pendenteLido).toMatchObject({ tentativas: 0, bloqueadoAte: null });
    const bloqueioPedido = new Date(Date.now() + 15 * 60_000);
    for (const [tentativas, ate] of [
      [1, null],
      [5, bloqueioPedido],
    ] as const)
      await porta.gravarSgh(
        c,
        linhaTela(m!, 'sadt.portal.tentativa', 'pedido_vinculo_profissional_externo', autocadastro),
        (g) =>
          g.registrarTentativaPortal({ id: pendenteLido!.id, tentativas, bloqueadoAte: ate, acertou: false }),
      );
    const bloqueado = await porta.acessoPorId(c, pendenteLido!.id);
    expect(bloqueado).toMatchObject({ situacao: 'pendente', tentativas: 5 });
    expect(Math.abs(bloqueado!.bloqueadoAte!.getTime() - bloqueioPedido.getTime())).toBeLessThan(1_000);
    expect(
      await um('SELECT tentativas_falhas FROM pedido_vinculo_profissional_externo WHERE id = ?', [
        autocadastro,
      ]),
    ).toMatchObject({ tentativas_falhas: 5 });
  });

  it('protocolo do portal: grava só o resumo, o novo revoga o anterior, tentativas e isolamento por estabelecimento', async () => {
    const c = contexto(m!);
    const resumo = (k: string) => k.repeat(64).slice(0, 64);
    const criar = (r: string) =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.portal.protocolo', 'protocolo_acesso_portal', null), (g) =>
        g.criarProtocoloPortal({
          paciente: m!.base.paciente,
          reg: m!.base.atendimento,
          protocoloResumo: r,
          usuario: m!.base.login,
        }),
      );
    const p1 = await criar(resumo('a'));
    expect(await porta.acessoPorProtocolo(c, resumo('a'))).toMatchObject({
      id: p1,
      perfil: 'paciente',
      paciente: m!.base.paciente,
      reg: m!.base.atendimento,
      situacao: 'ativo',
      tentativas: 0,
    });
    expect(
      await porta.acessoPorProtocolo({ ...c, estabelecimento: m!.base.outroEst }, resumo('a')),
    ).toBeNull();
    const p2 = await criar(resumo('b'));
    expect((await porta.acessoPorId(c, p1))?.situacao).toBe('revogado');
    expect(codigoDe(await criar('nao-hex').catch((x: unknown) => x))).toBe('protocolo-invalido');
    expect(
      codigoDe(
        await porta
          .gravarSgh(
            { ...c, estabelecimento: m!.base.outroEst },
            linhaTela(m!, 'sadt.portal.protocolo', 'protocolo_acesso_portal', null),
            (g) =>
              g.criarProtocoloPortal({
                paciente: m!.base.paciente,
                reg: m!.base.atendimento,
                protocoloResumo: resumo('c'),
                usuario: m!.base.login,
              }),
          )
          .catch((x: unknown) => x),
      ),
    ).toBe('atendimento-inexistente');
    await porta.gravarSgh(c, linhaTela(m!, 'sadt.portal.tentativa', 'protocolo_acesso_portal', p2), (g) =>
      g.registrarTentativaPortal({ id: p2, tentativas: 1, bloqueadoAte: null, acertou: false }),
    );
    expect(await porta.acessoPorId(c, p2)).toMatchObject({ tentativas: 1, situacao: 'ativo' });
    expect(
      await um('SELECT COUNT(*) AS q FROM protocolo_acesso_portal WHERE atendimento_id = ?', [
        m!.base.atendimento,
      ]),
    ).toMatchObject({ q: 2 });
  });
});
