// M56 (etapa 6, F5) na cópia: (1) pela porta do legado READ ONLY, a fatia desligada (regra 1; M61: desligada na transação desfeita), o apoio da tela,
// os motivos de glosa da tabela 38 do banco do estabelecimento (todos os que as críticas aplicam existem), a lista e as
// contagens dentro do tempo-alvo e a gravação recusada em dev sobre a cópia compartilhada; (2) numa transação SEMPRE
// desfeita, o serviço das contas inteiro sobre o banco real — a carteira da F1, a rede da F3 e a autorização da F4
// sintéticas → o lote em XML TISS 04.03.00 recebido (XSD, hash, protocolo, glosa automática) → o lote repetido recusado →
// a glosa do auditor e a desfeita → a conclusão → o demonstrativo no XSD → o recurso e a decisão → o pagamento → a
// devolução de outro lote —, só tabelas SGH_ escritas (nenhuma do outro sistema), uma linha de trilha por gravação e as
// recusas do banco. Dados SINTÉTICOS; no log, só contagens, códigos e tempos.
import { CRITICAS_CONTA } from '@sgh/contratos';
import { type Cabecalho, mensagemLoteGuias } from '@sgh/dominio-faturamento';
import {
  cnpjSintetico,
  numeroCarteirinha,
  protocoloAtendimento,
  protocoloConta,
  senhaAutorizacao,
  validadeDaSenha,
} from '@sgh/dominio-operadora';
import {
  contagemDasTabelasDaConta,
  credenciarPrestadorSgh,
  criarAcessoPortalSgh,
  type Escritor,
  escritasDaTransacao,
  type LinhaTrilha,
  type NucleoLegado,
  somenteSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GravadorAutorizacao } from '../autorizacao-porta.js';
import { portaAutorizacaoOperadoraLegado } from '../autorizacao-porta-legado.js';
import { ServicoAutorizacaoOperadora } from '../autorizacao-servico.js';
import type { GravadorContas } from '../contas-porta.js';
import { portaContasOperadoraLegado } from '../contas-porta-legado.js';
import { ServicoContasOperadora } from '../contas-servico.js';
import {
  COD,
  codigoDe,
  criarNucleo,
  montarCarteira,
  PODE,
  servicoNaTransacao,
  sessao,
  USUARIO,
} from './copia.spec-util.js';
import { situacaoComChavesDesligadas } from './chaves-desligadas.spec-util.js';

let nucleo: NucleoLegado;
beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  await nucleo.verificarSchema(COD);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

describe.skipIf(!PODE)('contas médicas da operadora na cópia (etapa 6, F5)', () => {
  it('a fatia desligada; o apoio, os motivos da tabela 38, a lista e as contagens pela porta do legado; a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: COD };
    const porta = portaContasOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, COD, 'SINT.OPE.AUDITOR', ['operadora.contas']);
    expect(s.fatias.find((f) => f.chave === 'operadora.contas')?.situacao).toBe('desligada');
    const servico = new ServicoContasOperadora(porta);
    const apoio = await servico.apoio(c, {
      ligada: false,
      motivo: 'desligada',
      podeLer: true,
      podeReceber: true,
      podeAnalisar: true,
      podePagar: true,
      login: 'SINT.OPE.AUDITOR',
    });
    expect(apoio).toMatchObject({
      podeReceber: false,
      operadoras: [],
      prestadores: [],
      motivos: [],
      auditor: null,
    });
    const t0 = performance.now();
    const motivos = await servico.motivos(c);
    const msMotivos = performance.now() - t0;
    expect(motivos.size).toBeGreaterThan(100);
    for (const k of Object.values(CRITICAS_CONTA)) expect(motivos.has(k.motivo), String(k.motivo)).toBe(true);
    const t1 = performance.now();
    const lista = await porta.contas(c, {});
    const totais = await porta.totais(c);
    const pag = await porta.pagamentos(c, { estado: 'a-pagar' });
    const msLista = performance.now() - t1;
    expect(msLista).toBeLessThan(300);
    expect(lista.itens.length).toBeLessThanOrEqual(50);
    await expect(porta.gravarSgh(c, {} as never, async () => 1)).rejects.toMatchObject({ status: 403 });
    console.log(
      `[int-m56-6] ${COD}: fatia das contas desligada; ${motivos.size} motivos de glosa da tabela 38 em ${Math.round(msMotivos)} ms (os ${new Set(Object.values(CRITICAS_CONTA).map((k) => k.motivo)).size} das críticas presentes); lista, contagens e pagamentos em ${Math.round(msLista)} ms (${totais.emAnalise} em análise, ${pag.itens.length} a pagar); gravação recusada em dev`,
    );
  });

  it('o ciclo inteiro numa transação desfeita: só SGH_; uma trilha por gravação; as recusas', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-6' };
    const contar = async (l: Pick<Escritor, 'consultar'>) =>
      (await trilhaDaOperadoraPorRecurso(l, COD, USUARIO))['operadora.contas'] ?? 0;
    const retrato = () =>
      nucleo.lerSomente(ctx, async (l) => ({
        ...(await contagemDasTabelasDaConta(l)),
        trilhas: await contar(l),
      }));
    const antes = await retrato();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico: servicoF1 } = servicoNaTransacao(e);
      const s = sessao(nucleo.rede);
      const k = await montarCarteira(servicoF1, s, { registro: '990566', base: '99066' });
      const carteirinha = k.titular.carteirinha!;
      const ss = somenteSgh(e);
      const documento = cnpjSintetico('905660010001');
      const lab = await credenciarPrestadorSgh(ss, {
        nomeFantasia: null,
        uf: 'SC',
        municipioIbge: 4205407,
        natureza: 1,
        contratacao: 1,
        operadoraIntermediaria: null,
        disponibilidade: 1,
        isencaoOnus: 1,
        urgencia: true,
        remuneracao: 1,
        contrato: { numero: 'SINT-M56-6', inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 1 },
        ehOHospital: false,
        estabelecimento: null,
        convenio: null,
        hospital: COD,
        pessoa: 'J',
        usuario: USUARIO,
        nome: 'Laboratório SINTÉTICO M56.6',
        cnes: '9056601',
        tipo: 4,
        classificacao: 3,
        regime: 1,
        documento,
      });
      const sobreE = {
        lerSomente: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['lerSomente'],
        gravarSgh: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['gravarSgh'],
      };
      const c = { rede: nucleo.rede, hospital: COD };
      const linha =
        (recurso: string, tabela: string) =>
        (operacao: string) =>
        (x: { id: number }): LinhaTrilha => ({
          rede: nucleo.rede,
          hospital: COD,
          usuario: USUARIO,
          evento: operacao,
          recurso,
          operacao,
          tabelaAlvo: tabela,
          idAlvo: String(x.id),
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'SGH-INTEGRACAO:m56-6',
          correlacao: 'integracao-m56-6',
          origem: 'SGH-INTEGRACAO:m56-6',
        });

      // A autorização da F4: o auditor designado e o SP/SADT autorizado com a senha.
      const portaAut = portaAutorizacaoOperadoraLegado(sobreE);
      const servicoAut = new ServicoAutorizacaoOperadora(portaAut);
      const linhaAut = linha('operadora.autorizacao', 'SGH_OPE_AUTORIZACAO');
      const gravarAut = <T extends { id: number }>(op: string, fn: (g: GravadorAutorizacao) => Promise<T>) =>
        portaAut.gravarSgh(c, linhaAut(op), fn);
      const auditor = await gravarAut('operadora.designarAuditor', (g) =>
        g.designar({
          operadora: k.operadora,
          login: USUARIO,
          nome: 'Auditor SINTÉTICO M56.6',
          categoria: 'medico',
          conselho: 'CRM',
          numero: '905661',
          uf: 'SC',
          inicio: '2026-10-01',
          usuario: USUARIO,
        }),
      );
      const conf = await servicoAut.conferirRegistro(c, {
        carteirinha,
        prestador: lab.id,
        executante: null,
        tipoGuia: 4,
        carater: 'E',
        altaComplexidade: false,
        origem: 1,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação SINTÉTICA da integração das contas',
        profissional: { nome: 'Profissional SINTÉTICO', conselho: 'CRM', numero: '905662', uf: 'SC' },
        internacao: null,
        itens: [{ tabela: 22, codigo: '40301630', descricao: null, quantidade: 2 }],
      } as never);
      const aut = await gravarAut('operadora.registrarAutorizacao', async (g) =>
        g.registrar({
          ...conf.registro,
          protocolo: protocoloAtendimento(
            conf.registroAns,
            conf.registro.solicitadaEm,
            await g.proximoProtocolo(),
          ),
          usuario: USUARIO,
        }),
      );
      const itensAut = (await portaAut.itens(c, aut.id)).map((i) => ({
        item: i.id,
        quantidadeAutorizada: i.quantidadeSolicitada,
      }));
      const dec = await servicoAut.conferirDecisao(
        c,
        aut.id,
        {
          decisao: 'autorizar',
          itens: itensAut,
          diariasAutorizadas: null,
          critica: null,
          fundamento: null,
        } as never,
        USUARIO,
        false,
      );
      let senha = '';
      await gravarAut('operadora.decidirAutorizacao', async (g) => {
        senha = senhaAutorizacao(dec.registroAns, await g.proximaSenha());
        return g.decidir({
          id: aut.id,
          versao: 1,
          situacao: dec.resultado.situacao,
          itens: dec.resultado.itens,
          diarias: dec.resultado.diarias,
          auditor: dec.auditor.id,
          critica: null,
          fundamento: null,
          parecer: 'Parecer SINTÉTICO',
          senha,
          senhaValidade: validadeDaSenha(dec.hoje),
          usuario: USUARIO,
        });
      });

      // As contas: o serviço inteiro sobre o banco real.
      const porta = portaContasOperadoraLegado(sobreE);
      const servico = new ServicoContasOperadora(porta);
      const linhaConta = linha('operadora.contas', 'SGH_OPE_CONTA');
      const gravar = <T extends { id: number }>(op: string, fn: (g: GravadorContas) => Promise<T>) =>
        porta.gravarSgh(c, linhaConta(op), fn);
      const { hoje } = await porta.relogio(c);
      const cab = (seq: string): Cabecalho => ({
        sequencialTransacao: seq,
        data: hoje,
        hora: '09:00:00',
        codigoPrestadorNaOperadora: documento,
        registroANS: '990566',
      });
      const sadt = (numero: string, carteira: string, comSenha: boolean) => ({
        tipo: 'sp-sadt' as const,
        numeroGuiaPrestador: numero,
        beneficiario: { numeroCarteira: carteira, atendimentoRN: 'N' as const },
        nomeContratadoSolicitante: 'LABORATORIO SINTETICO',
        profissionalSolicitante: { conselho: '06', numeroConselho: '905662', uf: '42', cbos: '225125' },
        cnes: '9056601',
        caraterAtendimento: '1' as const,
        tipoAtendimento: '23',
        ...(comSenha ? { autorizacao: { data: hoje, senha } } : {}),
        itens: [
          {
            sequencial: 1,
            data: '2026-10-20',
            procedimento: { codigoTabela: '22', codigo: '40301630', descricao: 'DOSAGEM SINTETICA' },
            quantidade: 3,
            valorUnitario: 12.35,
          },
        ],
        despesas: [
          {
            sequencial: 1,
            codigoDespesa: '03' as const,
            data: '2026-10-20',
            codigoTabela: '19',
            codigo: '70000001',
            descricao: 'MATERIAL SINTETICO',
            quantidade: 2,
            unidadeMedida: '036',
            valorUnitario: 5,
          },
        ],
      });
      const receber = async (bytes: Uint8Array) => {
        const x = await servico.conferirRecebimento(c, { arquivo: b64(bytes), nome: 'lote-int.xml' });
        let protocolo = '';
        const g = await gravar('operadora.receberConta', async (gr) => {
          protocolo = protocoloConta(hoje, await gr.proximoProtocolo());
          return gr.receber({
            ...x.recebimento,
            protocolo,
            texto: ServicoContasOperadora.textoDoRecebimento(protocolo, x),
            usuario: USUARIO,
          });
        });
        return { ...g, protocolo, x };
      };
      const lote = mensagemLoteGuias(cab('1'), 'INT-100', [
        sadt('INT-G-1', carteirinha, true),
        sadt('INT-G-2', numeroCarteirinha('990566', 999_999), false),
      ]);
      const t0 = performance.now();
      const r1 = await receber(lote.bytes);
      const msRecebimento = performance.now() - t0;
      const repetido = await codigoDe(receber(lote.bytes));
      const f1 = await servico.detalhe(c, r1.id, {
        login: USUARIO,
        podeAnalisar: true,
        podeReceber: true,
        podePagar: true,
      });
      const [g1, g2] = f1.guiasDetalhe;
      // O auditor: glosa o material e desfaz a glosa automática da quantidade; a versão velha recusada.
      const mat = g1!.itens[1]!.id;
      const qtd = g1!.itens[0]!.id;
      const e1 = {
        versao: 1,
        itens: [
          { item: mat, valorGlosado: 5, motivo: 2009, justificativa: 'Uma unidade sem registro de uso' },
        ],
      };
      const x1 = await servico.conferirGlosa(c, r1.id, e1, USUARIO);
      await gravar('operadora.glosarConta', (g) =>
        g.glosar({
          id: r1.id,
          versao: 1,
          itens: e1.itens,
          texto: x1.texto,
          desfeita: x1.desfeita,
          usuario: USUARIO,
        }),
      );
      const velha = await codigoDe(
        gravar('operadora.glosarConta', (g) =>
          g.glosar({ id: r1.id, versao: 1, itens: e1.itens, texto: 'x', desfeita: false, usuario: USUARIO }),
        ),
      );
      await gravar('operadora.glosarConta', (g) =>
        g.glosar({
          id: r1.id,
          versao: 2,
          itens: [{ item: qtd, valorGlosado: 0, motivo: null, justificativa: null }],
          texto: 'desfeita',
          desfeita: true,
          usuario: USUARIO,
        }),
      );
      const conc = await servico.conferirConclusao(c, r1.id, USUARIO);
      await gravar('operadora.concluirAnaliseConta', (g) =>
        g.concluir({
          id: r1.id,
          versao: 3,
          auditor: conc.auditor.id,
          situacao: conc.situacao,
          observacao: null,
          texto: conc.texto,
          usuario: USUARIO,
        }),
      );
      const demonstrativo = await servico.demonstrativo(c, r1.id);
      // O recurso da guia sem beneficiário e a decisão (acatado em parte); o pagamento do saldo.
      await servico.conferirRecurso(c, r1.id, { guia: g2!.id, valor: 47.05 });
      await gravar('operadora.registrarRecursoConta', (g) =>
        g.registrarRecurso({
          id: r1.id,
          versao: 4,
          guia: g2!.id,
          valor: 47.05,
          justificativa: 'Carteirinha digitada errada',
          situacao: 'analisada',
          // D-RECURSO-PROPRIO-566: quem registra o recurso não é o auditor que decide.
          usuario: 'SINT.OPE.ATENDE',
        }),
      );
      const dr = await servico.conferirDecisaoRecurso(
        c,
        r1.id,
        { guia: g2!.id, valorAcatado: 37.05 },
        USUARIO,
      );
      await gravar('operadora.decidirRecursoConta', (g) =>
        g.decidirRecurso({
          id: r1.id,
          versao: 5,
          guia: g2!.id,
          valorAcatado: 37.05,
          situacaoRecurso: dr.situacaoRecurso,
          parecer: 'Acatado o procedimento',
          situacao: dr.situacao,
          usuario: USUARIO,
        }),
      );
      const pg = await servico.conferirPagamento(c, r1.id, { valor: 79.1, data: hoje });
      await gravar('operadora.pagarConta', (g) =>
        g.pagar({
          id: r1.id,
          versao: 6,
          valor: 79.1,
          data: hoje,
          documento: 'TED SINTÉTICA',
          situacao: pg.situacao,
          usuario: USUARIO,
        }),
      );
      const acima = await codigoDe(servico.conferirPagamento(c, r1.id, { valor: 1, data: hoje }));
      const f2 = await servico.detalhe(c, r1.id, {
        login: USUARIO,
        podeAnalisar: true,
        podeReceber: true,
        podePagar: true,
      });
      // W0-10 (M8): o recurso por ITEM do prestador pelo portal no lote pago (a conta do portal sintética, FK do
      // ID_ACESSO), a repetição recusada antes de escrever e a decisão item a item por outra pessoa (acatado em parte).
      const acessoPortal = await criarAcessoPortalSgh(ss, {
        hospital: COD,
        operadora: k.operadora,
        prestador: lab.id,
        login: 'int-m56-6@prestador.invalid',
        nome: 'Responsável SINTÉTICO M56.6',
        funcoes: '1,2,3,7',
        tipoAtendimento: 1,
        ativacaoResumo: 'a'.repeat(64),
        ativacaoValidade: `${hoje}T23:59:59`,
        usuario: USUARIO,
      });
      const entradaItens = {
        versao: 7,
        guia: g1!.id,
        itens: [{ item: mat, valor: 5, justificativa: 'Material com registro de uso no anexo' }],
        justificativa: 'Recurso SINTÉTICO do material glosado',
      };
      const ri = await servico.conferirRecursoItens(c, r1.id, entradaItens);
      const regItens = await gravar('operadora.registrarRecursoItens', (g) =>
        g.registrarRecursoItens({
          id: r1.id,
          versao: 7,
          guia: g1!.id,
          itens: entradaItens.itens,
          justificativa: entradaItens.justificativa,
          situacao: ri.situacao,
          acesso: acessoPortal.id,
          usuario: 'SGH.PORTAL.PRESTADOR',
        }),
      );
      const itensRepetido = await codigoDe(servico.conferirRecursoItens(c, r1.id, entradaItens));
      const pendentesItens = await porta.recursosItens(c, r1.id);
      const entradaDecisao = {
        versao: 8,
        decisoes: [{ item: mat, valorAcatado: 3, parecer: 'Acatado o uso de três unidades' }],
        parecer: 'Parecer SINTÉTICO por item',
      };
      const di = await servico.conferirDecisaoRecursoItens(c, r1.id, g1!.id, entradaDecisao, USUARIO);
      const decItens = await gravar('operadora.decidirRecursoItens', (g) =>
        g.decidirRecursoItens({
          id: r1.id,
          versao: 8,
          guia: g1!.id,
          decisoes: entradaDecisao.decisoes,
          parecer: entradaDecisao.parecer,
          situacao: di.situacao,
          usuario: USUARIO,
        }),
      );
      const semPendente = await codigoDe(
        servico.conferirDecisaoRecursoItens(c, r1.id, g1!.id, entradaDecisao, USUARIO),
      );
      const decididosItens = await porta.recursosItens(c, r1.id);
      const f3 = await porta.conta(c, r1.id);
      // Outro lote (consulta) devolvido; a lista pela busca do protocolo.
      const loteB = mensagemLoteGuias(cab('2'), 'INT-200', [
        {
          tipo: 'consulta',
          numeroGuiaPrestador: 'INT-C-1',
          beneficiario: { numeroCarteira: carteirinha, atendimentoRN: 'N' },
          cnes: '9056601',
          profissional: { conselho: '06', numeroConselho: '905662', uf: '42', cbos: '225125' },
          dataAtendimento: '2026-10-20',
          tipoConsulta: '1',
          procedimento: { codigoTabela: '22', codigo: '10101012' },
          valor: 150,
        },
      ]);
      const rb = await receber(loteB.bytes);
      await servico.conferirDevolucao(c, rb.id, USUARIO);
      await gravar('operadora.devolverConta', (g) =>
        g.devolver({ id: rb.id, versao: 1, motivo: 'Lote SINTÉTICO devolvido', usuario: USUARIO }),
      );
      const t1 = performance.now();
      const porProtocolo = await porta.contas(c, { busca: r1.protocolo });
      const lista = await porta.contas(c, { prestador: lab.id });
      const ms = performance.now() - t1;
      const escritas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      return {
        auditor: auditor.id,
        r1,
        repetido,
        f1,
        velha,
        conc,
        demonstrativo,
        acima,
        f2,
        ri,
        regItens,
        itensRepetido,
        pendentesItens,
        di,
        decItens,
        semPendente,
        decididosItens,
        f3,
        rb,
        devolvida: (await porta.conta(c, rb.id))?.situacao,
        porProtocolo: porProtocolo.itens.map((x) => x.id),
        lista: lista.itens.length,
        ms,
        msRecebimento,
        escritas,
        trilhas: await contar(e),
      };
    });
    expect(r.r1.protocolo).toMatch(/^\d{12}$/);
    expect(r.r1.x).toMatchObject({ guias: 2, glosadoAutomatico: 59.4, itensGlosados: 3, guiasComCritica: 1 });
    expect(r.repetido).toBe('lote-ja-recebido');
    expect(r.f1).toMatchObject({
      situacao: 'recebida',
      apresentado: 94.1,
      glosado: 59.4,
      acoes: ['glosar', 'concluir', 'devolver'],
    });
    expect(r.f1.guiasDetalhe[0]).toMatchObject({ criticas: [], glosado: 12.35 });
    expect(r.f1.guiasDetalhe[0]!.autorizacao).not.toBeNull();
    expect(r.f1.guiasDetalhe[1]!.criticas.map((x) => x.codigo)).toEqual([
      'beneficiario-inexistente',
      'senha-ausente',
    ]);
    expect(r.f1.guiasDetalhe[0]!.itens[0]).toMatchObject({
      motivo: 1408,
      origem: 'automatica',
      motivoNome: expect.stringContaining('QUANTIDADE'),
    });
    expect(r.velha).toBe('conta-desatualizada');
    expect(r.conc).toMatchObject({ situacao: 'analisada', liberado: 42.05 });
    expect(r.demonstrativo.nome).toBe(`demonstrativo-${r.r1.protocolo}.xml`);
    expect(r.acima).toBe('nada-a-pagar');
    expect(r.f2).toMatchObject({ situacao: 'paga', acatado: 37.05, liberado: 79.1, pago: 79.1, saldo: 0 });
    expect(r.f2.eventos.map((x) => x.evento)).toEqual([
      'recebimento',
      'glosa',
      'glosa-desfeita',
      'analise',
      'recurso',
      'recurso-decidido',
      'pagamento',
    ]);
    // W0-10 (M8): o recurso por item na cópia (a porta do legado, o ID_ACESSO da conta do portal) e a decisão.
    expect(r.ri).toMatchObject({ valor: 5, situacao: 'paga' });
    expect(r.regItens.recursos).toHaveLength(1);
    expect(r.itensRepetido).toBe('recurso-ja-registrado');
    expect(r.pendentesItens).toEqual([
      expect.objectContaining({ valor: 5, por: 'SGH.PORTAL.PRESTADOR', decisao: null }),
    ]);
    expect(r.di).toMatchObject({ valorAcatado: 3, situacao: 'analisada' });
    expect(r.decItens).toMatchObject({ decisao: 'parcial', valorAcatado: 3 });
    expect(r.semPendente).toBe('sem-recurso-pendente');
    expect(r.decididosItens[0]!.decisao).toMatchObject({ decisao: 'parcial', valorAcatado: 3, por: USUARIO });
    expect(r.f3).toMatchObject({ situacao: 'analisada', acatado: 40.05 });
    expect(r.rb.x.itensGlosados).toBe(0);
    expect(r.devolvida).toBe('devolvida');
    expect(r.porProtocolo).toEqual([r.r1.id]);
    expect(r.lista).toBe(2);
    expect(r.ms).toBeLessThan(300);
    // Seção 5: só tabelas SGH_ (as da F1, da F3 e da F4 da carteira sintética, as da F5 e a trilha) na transação.
    expect(r.escritas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.escritas).toEqual(
      expect.arrayContaining([
        'SGH_OPE_CONTA',
        'SGH_OPE_CONTA_GUIA',
        'SGH_OPE_CONTA_ITEM',
        'SGH_OPE_CONTA_EVT',
        'SGH_OPE_CONTA_RECURSO_ITEM',
        'SGH_OPE_PORTAL_ACESSO',
        'SGH_TRILHA',
      ]),
    );
    // Uma linha de trilha por gravação da F5: 2 recebimentos, 2 glosas, a análise, o recurso e a decisão, o pagamento e a
    // devolução, mais o recurso por item e a decisão do W0-10 (o recebimento repetido e a versão velha foram recusados antes
    // de gravar ou desfeitos; a conta do portal sintética não passa pela trilha das contas).
    expect(r.trilhas - antes.trilhas).toBe(11);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[int-m56-6] ${COD}: ciclo F5 desfeito (lote de 2 guias recebido em ${Math.round(r.msRecebimento)} ms com a glosa automática de 3 itens, glosa do auditor e desfeita, análise, demonstrativo no XSD, recurso acatado em parte, pago; lote de consulta devolvido); recusas ${[r.repetido, r.velha, r.acima].join(', ')}; lista em ${Math.round(r.ms)} ms; escritas só em SGH_ (${r.escritas.length} tabelas); trilha ${r.trilhas - antes.trilhas}; ROLLBACK igual (${antes.contas} lotes)`,
    );
  });
});
