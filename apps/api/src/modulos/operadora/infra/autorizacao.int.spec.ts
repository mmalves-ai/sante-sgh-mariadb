// M56 (etapa 5, F4) na cópia: (1) pela porta do legado READ ONLY, a fatia desligada (regra 1; M61: desligada na transação desfeita), o apoio da
// tela com os domínios do banco (tipo de guia, origem, críticas da operadora, situação da guia), a terminologia TUSS e o
// CID do estabelecimento, a lista e as contagens dentro do tempo-alvo e a gravação recusada em dev sobre a cópia
// compartilhada; (2) numa transação SEMPRE desfeita, o serviço da autorização inteiro sobre o banco real — a carteira da
// F1 e a rede da F3 sintéticas → a designação do auditor → o pedido com o protocolo e o prazo → o complemento → a
// autorização com a senha → a crítica que bloqueia e a negativa com o comunicado → a urgência com a junta e a conclusão
// parcial → o SP/SADT ligado à internação → o cancelamento —, só tabelas SGH_ escritas (nenhuma do outro sistema), uma
// linha de trilha por gravação e as recusas do banco (auditor ativo único, versão vista). Dados SINTÉTICOS; no log, só
// contagens, códigos e tempos.
import {
  cnpjSintetico,
  protocoloAtendimento,
  senhaAutorizacao,
  senhaValida,
  validadeDaSenha,
} from '@sgh/dominio-operadora';
import {
  credenciarPrestadorSgh,
  type Escritor,
  escritasDaTransacao,
  contagemDasTabelasDaAutorizacao,
  type LinhaTrilha,
  type NucleoLegado,
  somenteSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GravadorAutorizacao, PortaAutorizacaoOperadora } from '../autorizacao-porta.js';
import { portaAutorizacaoOperadoraLegado } from '../autorizacao-porta-legado.js';
import { ServicoAutorizacaoOperadora } from '../autorizacao-servico.js';
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

describe.skipIf(!PODE)('autorização de guias da operadora na cópia (etapa 5, F4)', () => {
  it('a fatia desligada; o apoio, a terminologia, o CID, a lista e as contagens pela porta do legado; a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: COD };
    const porta = portaAutorizacaoOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, COD, 'SINT.OPE.AUDITOR', ['operadora.autorizacao']);
    expect(s.fatias.find((f) => f.chave === 'operadora.autorizacao')?.situacao).toBe('desligada');
    const servico = new ServicoAutorizacaoOperadora(porta);
    const apoio = await servico.apoio(c, {
      ligada: false,
      motivo: 'desligada',
      podeRegistrar: true,
      podeDecidir: true,
      podeDesignar: true,
      login: 'SINT.OPE.AUDITOR',
    });
    expect(apoio).toMatchObject({ podeRegistrar: false, operadoras: [], prestadores: [], auditor: null });
    // Os códigos do banco batem com os das regras (CDTPGUIA 1 a 4, SPORIGEM_ATEND 1 a 6, CDGUIASTATUS 1 a 9).
    expect(apoio.dominios.tipoGuia.map((x) => x.codigo)).toEqual([1, 2, 3, 4]);
    expect(apoio.dominios.tipoGuia[3]).toEqual({ codigo: 4, rotulo: 'SP/SADT' });
    expect(apoio.dominios.origem.map((x) => x.codigo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(apoio.dominios.origem[0]?.rotulo).toBe('Liberação de guias');
    expect(apoio.dominios.situacaoGuia.map((x) => x.codigo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(apoio.dominios.critica.length).toBeGreaterThan(0);
    expect(apoio.dominios.critica.every((x) => x.rotulo.length > 0)).toBe(true);
    const t0 = performance.now();
    const tuss = await porta.procedimentosTuss(c, ['10101012', '40301630', '00000000']);
    const busca = await porta.buscarTuss(c, 'consulta');
    const msTuss = performance.now() - t0;
    expect(tuss.map((x) => x.codigo).sort()).toEqual(['10101012', '40301630']);
    expect(tuss.every((x) => x.vigente)).toBe(true);
    expect(busca.length).toBeGreaterThan(0);
    expect(await porta.nomeDoCid(c, 'J189')).not.toBeNull();
    expect(await porta.nomeDoCid(c, 'Z9999')).toBeNull();
    const t1 = performance.now();
    const lista = await porta.autorizacoes(c, {});
    const totais = await porta.totais(c);
    const msLista = performance.now() - t1;
    expect(msLista).toBeLessThan(300);
    expect(lista.itens.length).toBeLessThanOrEqual(50);
    await expect(porta.gravarSgh(c, {} as never, async () => 1)).rejects.toMatchObject({ status: 403 });
    console.log(
      `[int-m56-5] ${COD}: fatia da autorização desligada; domínios ${Object.values(apoio.dominios).reduce((n, d) => n + d.length, 0)} códigos (${apoio.dominios.critica.length} críticas); TUSS e busca em ${Math.round(msTuss)} ms (${busca.length}); lista e contagens em ${Math.round(msLista)} ms (${totais.emAnalise} em análise); gravação recusada em dev`,
    );
  });

  it('o ciclo inteiro numa transação desfeita: só SGH_; uma trilha por gravação; as recusas do banco', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-5' };
    // A trilha da fatia do usuário do teste (pela porta do legado: a API não escreve SQL).
    const contar = async (l: Pick<Escritor, 'consultar'>) =>
      (await trilhaDaOperadoraPorRecurso(l, COD, USUARIO))['operadora.autorizacao'] ?? 0;
    const retrato = () =>
      nucleo.lerSomente(ctx, async (l) => ({
        ...(await contagemDasTabelasDaAutorizacao(l)),
        trilhas: await contar(l),
      }));
    const antes = await retrato();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico: servicoF1 } = servicoNaTransacao(e);
      const s = sessao(nucleo.rede);
      const k = await montarCarteira(servicoF1, s, { registro: '990565', base: '99065' });
      const carteirinha = k.titular.carteirinha!;
      // A rede sintética da F3: um laboratório (ambulatorial) e um hospital (ambulatorial e hospitalar).
      const base = {
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
        contrato: { numero: 'SINT-M56-5', inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 1 },
        ehOHospital: false,
        estabelecimento: null,
        convenio: null,
        hospital: COD,
        pessoa: 'J' as const,
        usuario: USUARIO,
      };
      const ss = somenteSgh(e);
      const lab = await credenciarPrestadorSgh(ss, {
        ...base,
        nome: 'Laboratório SINTÉTICO M56.5',
        cnes: '9056501',
        tipo: 4,
        classificacao: 3,
        regime: 1,
        documento: cnpjSintetico('905650010001'),
      });
      const hosp = await credenciarPrestadorSgh(ss, {
        ...base,
        nome: 'Hospital SINTÉTICO M56.5',
        cnes: '9056502',
        tipo: 3,
        classificacao: 1,
        regime: 3,
        documento: cnpjSintetico('905650020001'),
      });

      const porta: PortaAutorizacaoOperadora = portaAutorizacaoOperadoraLegado({
        lerSomente: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['lerSomente'],
        gravarSgh: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['gravarSgh'],
      });
      const servico = new ServicoAutorizacaoOperadora(porta);
      const c = { rede: nucleo.rede, hospital: COD };
      const linha =
        (operacao: string) =>
        (x: { id: number }): LinhaTrilha => ({
          rede: nucleo.rede,
          hospital: COD,
          usuario: USUARIO,
          evento: operacao,
          recurso: 'operadora.autorizacao',
          operacao,
          tabelaAlvo: 'SGH_OPE_AUTORIZACAO',
          idAlvo: String(x.id),
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'SGH-INTEGRACAO:m56-5',
          correlacao: 'integracao-m56-5',
          origem: 'SGH-INTEGRACAO:m56-5',
        });
      const gravar = <T extends { id: number }>(op: string, fn: (g: GravadorAutorizacao) => Promise<T>) =>
        porta.gravarSgh(c, linha(op), fn);

      // A diretoria designa o usuário do teste como médico auditor; de novo, a chave única recusa.
      await gravar('operadora.designarAuditor', (g) =>
        g.designar({
          operadora: k.operadora,
          login: USUARIO,
          nome: 'Auditor SINTÉTICO M56.5',
          categoria: 'medico',
          conselho: 'CRM',
          numero: '905651',
          uf: 'SC',
          inicio: '2026-10-01',
          usuario: USUARIO,
        }),
      );
      const repetido = await codigoDe(
        gravar('operadora.designarAuditor', (g) =>
          g.designar({
            operadora: k.operadora,
            login: USUARIO,
            nome: 'Repetido',
            categoria: 'medico',
            conselho: 'CRM',
            numero: '1',
            uf: 'SC',
            inicio: '2026-10-01',
            usuario: USUARIO,
          }),
        ),
      );

      const profissional = {
        nome: 'Profissional SINTÉTICO',
        conselho: 'CRM' as const,
        numero: '905652',
        uf: 'SC' as const,
      };
      const pedido = (x: Record<string, unknown> = {}) => ({
        carteirinha,
        prestador: lab.id,
        executante: null,
        tipoGuia: 4,
        carater: 'E' as const,
        altaComplexidade: false,
        origem: 1,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação SINTÉTICA da integração',
        profissional,
        internacao: null,
        itens: [
          { tabela: 22 as const, codigo: '40301630', descricao: null, quantidade: 2 },
          { tabela: 22 as const, codigo: '10101012', descricao: null, quantidade: 1 },
        ],
        ...x,
      });
      const registrar = async (x: Record<string, unknown> = {}) => {
        const conf = await servico.conferirRegistro(c, pedido(x) as never);
        let protocolo = '';
        const g = await gravar('operadora.registrarAutorizacao', async (gr) => {
          protocolo = protocoloAtendimento(
            conf.registroAns,
            conf.registro.solicitadaEm,
            await gr.proximoProtocolo(),
          );
          return gr.registrar({ ...conf.registro, protocolo, usuario: USUARIO });
        });
        return { ...g, protocolo, prazoTipo: conf.registro.prazoTipo };
      };
      const decidir = async (
        id: number,
        versao: number,
        x: Record<string, unknown>,
        junta: string | null = null,
      ) => {
        const conf = await servico.conferirDecisao(c, id, x as never, USUARIO, junta !== null);
        const autorizada = conf.resultado.situacao !== 'negada';
        return gravar(junta ? 'operadora.concluirJunta' : 'operadora.decidirAutorizacao', async (g) =>
          g.decidir({
            id,
            versao,
            situacao: conf.resultado.situacao,
            itens: conf.resultado.itens,
            diarias: conf.resultado.diarias,
            auditor: conf.auditor.id,
            critica: conf.resultado.situacao === 'autorizada' ? null : (x['critica'] as number),
            fundamento: conf.resultado.situacao === 'autorizada' ? null : (x['fundamento'] as string),
            parecer: 'Parecer SINTÉTICO da integração',
            senha: autorizada ? senhaAutorizacao(conf.registroAns, await g.proximaSenha()) : null,
            senhaValidade: autorizada ? validadeDaSenha(conf.hoje) : null,
            ...(junta ? { parecerJunta: junta } : {}),
            usuario: USUARIO,
          }),
        );
      };

      // 1) SP/SADT eletivo no laboratório: protocolo, complemento, autorização com a senha.
      const p1 = await registrar();
      await servico.conferirComplemento(c, p1.id, USUARIO);
      await gravar('operadora.pedirComplemento', (g) =>
        g.pedirComplemento({ id: p1.id, versao: 1, pedido: 'Laudo SINTÉTICO anterior', usuario: USUARIO }),
      );
      await gravar('operadora.responderComplemento', (g) =>
        g.responderComplemento({
          id: p1.id,
          versao: 2,
          resposta: 'Laudo SINTÉTICO enviado',
          usuario: USUARIO,
        }),
      );
      const itens1 = (await porta.itens(c, p1.id)).map((i) => ({
        item: i.id,
        quantidadeAutorizada: i.quantidadeSolicitada,
      }));
      const d1 = await decidir(p1.id, 3, {
        decisao: 'autorizar',
        itens: itens1,
        diariasAutorizadas: null,
        critica: null,
        fundamento: null,
      });
      const f1 = await servico.detalhe(c, p1.id);
      const velha = await codigoDe(
        gravar('operadora.pedirComplemento', (g) =>
          g.pedirComplemento({ id: p1.id, versao: 3, pedido: 'Versão velha SINTÉTICA', usuario: USUARIO }),
        ),
      );

      // 2) Internação eletiva no laboratório: a crítica bloqueia; a negativa com o comunicado.
      const critica = (await porta.dominios(c)).critica[0]!.codigo;
      const p2 = await registrar({
        tipoGuia: 3,
        cid: 'J189',
        internacao: { tipo: 1, diarias: 3, admissaoPrevista: '2099-01-02' },
      });
      const itens2 = (await porta.itens(c, p2.id)).map((i) => ({
        item: i.id,
        quantidadeAutorizada: i.quantidadeSolicitada,
      }));
      const bloqueada = await codigoDe(
        servico.conferirDecisao(
          c,
          p2.id,
          { decisao: 'autorizar', itens: itens2, diariasAutorizadas: 3, critica: null, fundamento: null },
          USUARIO,
          false,
        ),
      );
      await decidir(p2.id, 1, {
        decisao: 'negar',
        itens: [],
        diariasAutorizadas: null,
        critica,
        fundamento: 'Cláusula SINTÉTICA 5',
      });
      const f2 = await servico.detalhe(c, p2.id);

      // 3) Urgência no hospital: prazo imediato; junta; conclusão parcial (2 de 3 diárias).
      const p3 = await registrar({
        prestador: hosp.id,
        carater: 'U',
        tipoGuia: 3,
        cid: 'K359',
        internacao: { tipo: 2, diarias: 3, admissaoPrevista: '2026-10-01' },
      });
      await servico.conferirJunta(
        c,
        p3.id,
        { notificadosEm: '2026-10-01', desempatador: { nome: 'x', crm: '905653', uf: 'SC' } } as never,
        USUARIO,
      );
      await gravar('operadora.abrirJunta', (g) =>
        g.abrirJunta({
          id: p3.id,
          versao: 1,
          divergencia: 'Divergência SINTÉTICA',
          desempatador: { nome: 'Desempatador SINTÉTICO', crm: '905653', uf: 'SC' },
          notificadosEm: '2026-10-01',
          usuario: USUARIO,
        }),
      );
      const itens3 = (await porta.itens(c, p3.id)).map((i) => ({
        item: i.id,
        quantidadeAutorizada: i.quantidadeSolicitada,
      }));
      const d3 = await decidir(
        p3.id,
        2,
        {
          decisao: 'autorizar',
          itens: itens3,
          diariasAutorizadas: 2,
          critica,
          fundamento: 'Parecer da junta SINTÉTICO',
        },
        'Desempatador SINTÉTICO favorável a 2 diárias',
      );
      const f3 = await servico.detalhe(c, p3.id);

      // 4) SP/SADT ligado à internação autorizada em parte; 5) cancelamento da autorização ainda válida.
      const p4 = await registrar({ prestador: hosp.id, guiaPrincipal: p3.id });
      await servico.conferirCancelamento(c, p1.id);
      await gravar('operadora.cancelarAutorizacao', (g) =>
        g.cancelar({ id: p1.id, versao: d1.versao, motivo: 'Cancelamento SINTÉTICO', usuario: USUARIO }),
      );

      // W0-10: o auditor que pede o complemento assume o pedido; alterar a designação guarda a versão anterior; trocar o
      // auditor com o pedido em análise recusa sem a redistribuição e, com ela, o outro auditor responde pelo pedido.
      await gravar('operadora.pedirComplemento', (g) =>
        g.pedirComplemento({ id: p4.id, versao: 1, pedido: 'Laudo SINTÉTICO W0-10', usuario: USUARIO }),
      );
      const [designado] = (await porta.auditores(c)).filter(
        (a) => a.login === USUARIO && a.situacao === 'ativo',
      );
      await gravar('operadora.alterarAuditor', (g) =>
        g.alterar({
          id: designado!.id,
          versao: designado!.versao,
          nome: 'Auditor SINTÉTICO M56.5 alterado',
          categoria: 'medico',
          conselho: 'CRM',
          numero: '905653',
          uf: 'PR',
          motivo: 'Transferência SINTÉTICA de conselho',
          usuario: USUARIO,
        }),
      );
      const alterado = await porta.auditor(c, designado!.id);
      const semRedistribuir = await codigoDe(
        gravar('operadora.encerrarAuditor', (g) =>
          g.encerrar({
            id: designado!.id,
            versao: alterado!.versao,
            motivo: 'Troca SINTÉTICA',
            usuario: USUARIO,
          }),
        ),
      );
      const outro = await gravar('operadora.designarAuditor', (g) =>
        g.designar({
          operadora: k.operadora,
          login: 'SINT.AUD2.W010',
          nome: 'Auditor SINTÉTICO dois',
          categoria: 'medico',
          conselho: 'CRM',
          numero: '905654',
          uf: 'SC',
          inicio: '2026-10-01',
          usuario: USUARIO,
        }),
      );
      const redistribuido = await gravar('operadora.encerrarAuditor', (g) =>
        g.encerrar({
          id: designado!.id,
          versao: alterado!.versao,
          motivo: 'Troca SINTÉTICA',
          usuario: USUARIO,
          redistribuirPara: outro.id,
        }),
      );
      const troca = {
        antes: designado!.emAnalise,
        alterado: alterado && {
          nome: alterado.nome,
          numero: alterado.numero,
          uf: alterado.uf,
          emAnalise: alterado.emAnalise,
        },
        semRedistribuir,
        redistribuidos: redistribuido.redistribuidos,
        doOutro: (await porta.auditor(c, outro.id))?.emAnalise,
      };

      const t0 = performance.now();
      const porProtocolo = await porta.autorizacoes(c, servico.filtro({ busca: p2.protocolo }));
      const porCarteirinha = await porta.autorizacoes(c, servico.filtro({ busca: carteirinha }));
      const totais = await porta.totais(c);
      const ms = performance.now() - t0;
      const auditores = (await porta.auditores(c)).filter((a) => a.login === USUARIO);
      const escritas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      return {
        repetido,
        p1,
        d1,
        f1,
        velha,
        bloqueada,
        f2,
        p3,
        d3,
        f3,
        p4,
        porProtocolo: porProtocolo.itens.map((x) => x.id),
        porCarteirinha: porCarteirinha.itens.length,
        totais,
        ms,
        auditores: auditores.length,
        troca,
        cancelado: (await porta.autorizacao(c, p1.id))?.situacao,
        escritas,
        trilhas: await contar(e),
        ids: [p2.id],
      };
    });
    expect(r.repetido).toBe('auditor-ja-designado');
    expect(r.p1.protocolo).toMatch(/^990565\d{14}$/);
    expect(r.p1.prazoTipo).toBe('padrao');
    expect(r.f1).toMatchObject({ situacao: 'autorizada', situacaoGuia: 1 });
    expect(senhaValida(r.f1.senha!)).toBe(true);
    expect(r.f1.itens.map((i) => i.situacao)).toEqual(['autorizado', 'autorizado']);
    expect(r.f1.itens[0]!.descricao.length).toBeGreaterThan(3);
    expect(r.f1.eventos.map((x) => x.evento)).toEqual([
      'registro',
      'complemento-pedido',
      'complemento-resposta',
      'decisao',
    ]);
    expect(r.velha).toBe('autorizacao-desatualizada');
    expect(r.bloqueada).toBe('critica-bloqueante');
    expect(r.f2.situacao).toBe('negada');
    expect(r.f2.comunicado).toContain('Fundamento: Cláusula SINTÉTICA 5.');
    expect(r.f2.cidNome).not.toBeNull();
    expect(r.p3.prazoTipo).toBe('imediato');
    expect(r.f3).toMatchObject({
      situacao: 'parcial',
      internacao: { diarias: 3, diariasAutorizadas: 2 },
      junta: { parecer: 'Desempatador SINTÉTICO favorável a 2 diárias' },
    });
    expect(r.porProtocolo).toEqual(r.ids);
    expect(r.porCarteirinha).toBe(4);
    expect(r.cancelado).toBe('cancelada');
    expect(r.auditores).toBe(1);
    expect(r.troca).toEqual({
      antes: 1,
      alterado: { nome: 'Auditor SINTÉTICO M56.5 alterado', numero: '905653', uf: 'PR', emAnalise: 1 },
      semRedistribuir: 'auditor-com-autorizacoes',
      redistribuidos: 1,
      doOutro: 1,
    });
    expect(r.ms).toBeLessThan(300);
    // Seção 5: só tabelas SGH_ (as da F1 e da F3 da carteira sintética, as da F4 e a trilha) na transação.
    expect(r.escritas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.escritas).toEqual(
      expect.arrayContaining([
        'SGH_OPE_AUDITOR',
        'SGH_OPE_AUTORIZACAO',
        'SGH_OPE_AUTORIZACAO_EVT',
        'SGH_OPE_AUTORIZACAO_ITEM',
        'SGH_OPE_AUT_RESPONSAVEL',
        'SGH_OPE_AUDITOR_HIST',
        'SGH_TRILHA',
      ]),
    );
    // Uma linha de trilha por gravação da F4: 1 designação, 4 registros, complemento e resposta, 2 decisões, a junta, a
    // conclusão e o cancelamento (a designação repetida foi desfeita com a transação dela).
    // W0-10: + o complemento do 4º pedido, a alteração, a 2ª designação e o encerramento com a redistribuição (a recusa
    // foi desfeita com a transação dela).
    expect(r.trilhas - antes.trilhas).toBe(16);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[int-m56-5] ${COD}: ciclo F4 desfeito (4 pedidos: autorizado e cancelado, negado, parcial pela junta, SP/SADT ligado); recusas ${[r.repetido, r.velha, r.bloqueada].join(', ')}; lista em ${Math.round(r.ms)} ms; escritas só em SGH_ (${r.escritas.length} tabelas); trilha ${r.trilhas - antes.trilhas}; ROLLBACK igual (${antes.pedidos} pedidos, ${antes.auditores} auditores)`,
    );
  });
});
