// M56 (etapa 8, F7) na cópia: (1) pela porta do legado READ ONLY, as duas chaves da fatia desligadas por padrão (regra
// 1), os domínios do banco (origem do atendimento, funções do portal, tipos de atendimento), a lista e as contagens dentro
// do tempo-alvo, a consulta de um número que não existe e a gravação recusada em dev sobre a cópia compartilhada; (2)
// numa transação SEMPRE desfeita, a API inteira (o controlador e o serviço do portal, com as chaves ligadas só no teste)
// sobre o banco real — a carteira da F1 e a rede da F3 sintéticas → o protocolo de cobertura com o número e o prazo → a
// análise, o contato e a resposta desfavorável (recusada sem o fundamento) → a resposta por escrito pedida e enviada → o
// encerramento → a reanálise na ouvidoria com a prorrogação única → a NIP → o cancelamento → a versão velha recusada →
// a conta do portal com o código de uso único → a ativação (senha e segundo fator) → a entrada com o código do
// aplicativo → o pedido de autorização pelo portal (origem do portal, prestador da conta) → a consulta do protocolo
// pelo prestador → o cancelamento do pedido —, só tabelas SGH_ escritas (nenhuma do outro sistema), uma linha de trilha
// por gravação e o ROLLBACK igual. Dados SINTÉTICOS; no log, só contagens, códigos e tempos.
import { createHash, randomBytes } from 'node:crypto';
import { codigoTotp, criarAbility, regrasDeAcesso } from '@sgh/dominio-acesso';
import { esquemaRegistrarProtocoloOpe } from '@sgh/contratos';
import { cnpjSintetico, protocoloAtendimento } from '@sgh/dominio-operadora';
import {
  contagemDasTabelasDoAtendimento,
  credenciarPrestadorSgh,
  type Escritor,
  escritasDaTransacao,
  type LinhaTrilha,
  type NucleoLegado,
  somenteSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import { portaAtendimentoOperadoraLegado } from '../atendimento-porta-legado.js';
import { ServicoAtendimentoOperadora } from '../atendimento-servico.js';
import { AtendimentoOperadoraController } from '../atendimento.controller.js';
import { portaAutorizacaoOperadoraLegado } from '../autorizacao-porta-legado.js';
import { ServicoPortalPrestador, USUARIO_PORTAL_PRESTADOR } from '../portal-prestador-servico.js';
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
}, 60_000);
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

const PERMISSOES = [
  'operadora.protocolo.ler',
  'operadora.protocolo.registrar',
  'operadora.prestador.ler',
  'operadora.prestador.editar',
];
const chave = (c: string) => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-26T10:00:00',
});
const pre = (recurso: string, tipo: string) => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-26T10:00:00',
});
/** As chaves da operadora ligadas SÓ no teste (a cópia segue com todas desligadas). */
const fonteLigada = {
  chaves: async () =>
    [
      'operadora',
      'operadora.beneficiarios',
      'operadora.autorizacao',
      'operadora.atendimento',
      'operadora.portalPrestador',
    ].map(chave),
  prerequisitos: async () => [pre('operadora', 'credenciamento'), pre('operadora.autorizacao', 'aprovacao')],
} as unknown as FonteConfiguracao;
const semTrilhaExtra: RegistradorTrilha = {
  registrar: async () => undefined,
} as unknown as RegistradorTrilha;

describe.skipIf(!PODE)('atendimento com protocolo e portal do prestador na cópia (etapa 8, F7)', () => {
  it('as chaves desligadas; os domínios, a lista, as contagens e a consulta pela porta do legado; a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: COD };
    const porta = portaAtendimentoOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, COD, 'SINT.OPE.ATENDENTE', [
      'operadora.atendimento',
      'operadora.portalPrestador',
    ]);
    expect(s.fatias.find((f) => f.chave === 'operadora.atendimento')?.situacao).toBe('desligada');
    expect(s.fatias.find((f) => f.chave === 'operadora.portalPrestador')?.situacao).toBe('desligada');
    const servico = new ServicoAtendimentoOperadora(
      porta,
      portaAutorizacaoOperadoraLegado(nucleo, { sghSoLeitura: true }),
    );
    const apoio = await servico.apoio(c, { ligada: false, motivo: 'desligada', podeRegistrar: true });
    expect(apoio).toMatchObject({ podeRegistrar: false, operadoras: [] });
    expect(apoio.dominios.origem.map((x) => x.codigo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(apoio.dominios.origem.find((x) => x.codigo === 4)?.rotulo.length).toBeGreaterThan(3);
    const dominios = await porta.dominios(c);
    expect(dominios.funcoesPortal.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(dominios.tiposAtendimento.length).toBe(5);
    const acessos = await servico.acessos(c, { ligada: false, motivo: 'desligada', podeEditar: true }, []);
    expect(acessos.itens).toEqual([]);
    expect(acessos.funcoes.filter((f) => f.liberavel).map((f) => f.codigo)).toEqual([1, 2, 3, 7]);
    const t0 = performance.now();
    const lista = await porta.protocolos(c, {});
    const totais = await porta.totais(c);
    const nada = await porta.consulta(c, '00000000000000000000');
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    expect(lista.itens.length).toBeLessThanOrEqual(50);
    expect(nada).toBeNull();
    await expect(porta.gravarSgh(c, {} as never, async () => 1)).rejects.toMatchObject({ status: 403 });
    console.log(
      `[int-m56-8] ${COD}: chaves do atendimento e do portal desligadas; domínios ${apoio.dominios.origem.length} origens, ${dominios.funcoesPortal.length} funções, ${dominios.tiposAtendimento.length} tipos; lista, contagens e consulta em ${Math.round(ms)} ms (${totais.abertos} abertos); gravação recusada em dev`,
    );
  });

  it('o ciclo inteiro pela API numa transação desfeita: só SGH_; uma trilha por gravação; as recusas', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-8' };
    const contar = async (l: Pick<Escritor, 'consultar'>) => {
      const a = await trilhaDaOperadoraPorRecurso(l, COD, USUARIO);
      const p = await trilhaDaOperadoraPorRecurso(l, COD, USUARIO_PORTAL_PRESTADOR);
      return {
        atendimento: a['operadora.atendimento'] ?? 0,
        portal: p['operadora.portalPrestador'] ?? 0,
      };
    };
    const retrato = () =>
      nucleo.lerSomente(ctx, async (l) => ({
        ...(await contagemDasTabelasDoAtendimento(l)),
        trilhas: await contar(l),
      }));
    const antes = await retrato();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico: servicoF1 } = servicoNaTransacao(e);
      const k = await montarCarteira(servicoF1, sessao(nucleo.rede), { registro: '990568', base: '99068' });
      const carteirinha = k.titular.carteirinha!;
      const lab = await credenciarPrestadorSgh(somenteSgh(e), {
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
        contrato: { numero: 'SINT-M56-8', inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 1 },
        ehOHospital: false,
        estabelecimento: null,
        convenio: null,
        hospital: COD,
        pessoa: 'J',
        usuario: USUARIO,
        nome: 'Laboratório SINTÉTICO M56.8',
        cnes: '9056801',
        tipo: 4,
        classificacao: 3,
        regime: 1,
        documento: cnpjSintetico('905680010001'),
      });

      const naTransacao = {
        lerSomente: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['lerSomente'],
        gravarSgh: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['gravarSgh'],
      };
      const porta = portaAtendimentoOperadoraLegado(naTransacao);
      const autorizacoes = portaAutorizacaoOperadoraLegado(naTransacao);
      const api = new AtendimentoOperadoraController(porta, autorizacoes, semTrilhaExtra, fonteLigada, null);
      const req = {
        headers: { 'user-agent': 'integracao-m56-8' },
        ip: '127.0.0.1',
        sgh: {
          sessao: {
            estabelecimentoAtivo: COD,
            rede: nucleo.rede,
            usuario: { login: USUARIO, id: USUARIO },
            unidadeAtiva: null,
          },
          ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
        },
      } as unknown as RequisicaoAutorizada;
      const t0 = performance.now();

      // Atendimento: a cobertura com o número e o prazo; análise, contato e a resposta (sem fundamento, recusada).
      const p1 = await api.registrar(
        {
          operadora: k.operadora,
          instancia: 'atendimento',
          natureza: 'cobertura',
          canal: 'telefone',
          origem: 1,
          solicitante: 'beneficiario',
          carteirinha,
          assunto: 'Cobertura de exame SINTÉTICO',
          relato: 'Relato SINTÉTICO do pedido de cobertura do beneficiário.',
          escritaPedida: false,
        },
        req,
      );
      const a1 = await api.analisar(String(p1.id), { versao: p1.versao }, req);
      const c1 = await api.interagir(
        String(p1.id),
        { versao: a1.versao, texto: 'Contato SINTÉTICO com o beneficiário.' },
        req,
      );
      const semFundamento = await codigoDe(
        api.responder(
          String(p1.id),
          {
            versao: c1.versao,
            conclusao: 'desfavoravel',
            resposta: 'Resposta SINTÉTICA desfavorável ao beneficiário.',
            meio: 'telefone',
          },
          req,
        ),
      );
      // A versão vista antes da análise: o banco recusa (a interação vale em análise).
      const velha = await codigoDe(
        api.interagir(String(p1.id), { versao: p1.versao, texto: 'Contato SINTÉTICO atrasado.' }, req),
      );
      const r1 = await api.responder(
        String(p1.id),
        {
          versao: c1.versao,
          conclusao: 'desfavoravel',
          resposta: 'Resposta SINTÉTICA desfavorável ao beneficiário.',
          fundamento: 'Cláusula SINTÉTICA 7.',
          meio: 'telefone',
        },
        req,
      );
      const w1 = await api.pedirEscrita(String(p1.id), { versao: r1.versao }, req);
      const fichaEscrita = await api.ficha(String(p1.id), req);
      const encerrarAntes = await codigoDe(api.encerrar(String(p1.id), { versao: w1.versao }, req));
      const v1 = await api.enviarEscrita(String(p1.id), { versao: w1.versao, meio: 'email' }, req);
      const e1 = await api.encerrar(String(p1.id), { versao: v1.versao }, req);

      // Reanálise na ouvidoria (novo protocolo ligado) com a prorrogação única.
      const o1 = await api.reanalise(
        String(p1.id),
        {
          versao: e1.versao,
          canal: 'eletronico',
          origem: 1,
          relato: 'Pedido SINTÉTICO de reanálise.',
          escritaPedida: false,
        },
        req,
      );
      const fo = await api.ficha(String(o1.id), req);
      const dupla = await codigoDe(
        api.reanalise(
          String(p1.id),
          {
            versao: e1.versao,
            canal: 'telefone',
            origem: 1,
            relato: 'Outro pedido SINTÉTICO.',
            escritaPedida: false,
          },
          req,
        ),
      );
      const pr = await api.prorrogar(
        String(o1.id),
        {
          versao: o1.versao,
          ate: fo.prorrogavelAte!.slice(0, 10),
          motivo: 'Prazo acordado SINTÉTICO com o beneficiário.',
        },
        req,
      );
      const outra = await codigoDe(
        api.prorrogar(
          String(o1.id),
          {
            versao: pr.versao,
            ate: fo.prorrogavelAte!.slice(0, 10),
            motivo: 'Segunda prorrogação SINTÉTICA.',
          },
          req,
        ),
      );
      const ro = await api.responder(
        String(o1.id),
        {
          versao: pr.versao,
          conclusao: 'favoravel',
          resposta: 'Reanálise SINTÉTICA favorável ao beneficiário.',
          meio: 'email',
        },
        req,
      );

      // A NIP (canal e solicitante da ANS) e um cancelamento.
      const nip = await api.registrar(
        {
          operadora: k.operadora,
          instancia: 'nip',
          natureza: 'reembolso',
          canal: 'ans',
          origem: 1,
          solicitante: 'ans',
          carteirinha,
          numeroNip: '90568000001',
          assunto: 'Notificação SINTÉTICA da ANS',
          relato: 'Relato SINTÉTICO da demanda da ANS.',
          escritaPedida: false,
        },
        req,
      );
      const cn = await api.cancelar(
        String(nip.id),
        { versao: nip.versao, motivo: 'Cancelamento SINTÉTICO de teste.' },
        req,
      );

      const lista = await api.lista({ busca: p1.protocolo }, req);
      const consulta = await api.consulta({ numero: o1.protocolo }, req);
      const f1 = await api.ficha(String(p1.id), req);

      // Contas do portal: a criação com o código; a função não liberável recusada.
      const naoLiberavel = await codigoDe(
        api.criarAcesso(
          {
            operadora: k.operadora,
            prestador: lab.id,
            login: 'outro@prestador.invalid',
            nome: 'Responsável SINTÉTICO',
            funcoes: [1, 8],
            tipoAtendimento: 1,
          },
          req,
        ),
      );
      const conta = await api.criarAcesso(
        {
          operadora: k.operadora,
          prestador: lab.id,
          login: 'responsavel@prestador.invalid',
          nome: 'Responsável SINTÉTICO',
          funcoes: [1, 2, 3, 7],
          tipoAtendimento: 1,
        },
        req,
      );
      const contas = await api.acessos(req);

      // O portal: ativação, entrada com o código do aplicativo, pedido, consulta e cancelamento.
      const portal = new ServicoPortalPrestador(
        porta,
        autorizacoes,
        new ServicoSituacaoOperadora(fonteLigada, null),
        nucleo.rede,
        randomBytes(32),
        'Sante SGH',
      );
      const senha = `SenhaSintetica${randomBytes(4).toString('hex')}1`;
      const at = await portal.ativar(
        COD,
        { login: 'responsavel@prestador.invalid', codigo: conta.codigoAtivacao!, senha },
        '127.0.0.9',
      );
      const reuso = await codigoDe(
        portal.ativar(
          COD,
          { login: 'responsavel@prestador.invalid', codigo: conta.codigoAtivacao!, senha },
          '127.0.0.9',
        ),
      );
      const segredo = new URL(at.otpauth).searchParams.get('secret')!;
      const errada = await codigoDe(
        portal.entrar(
          COD,
          { login: 'responsavel@prestador.invalid', senha: `${senha}x`, codigo: '000000' },
          '127.0.0.9',
        ),
      );
      const ent = await portal.entrar(
        COD,
        { login: 'responsavel@prestador.invalid', senha, codigo: codigoTotp(segredo, Date.now()) },
        '127.0.0.9',
      );
      const sp = portal.sessao(ent.id);
      const pedido = await portal.solicitar(
        sp,
        {
          carteirinha,
          prestador: lab.id,
          executante: null,
          tipoGuia: 4,
          carater: 'E',
          altaComplexidade: false,
          origem: 4,
          guiaPrincipal: null,
          cid: null,
          indicacaoClinica: 'Indicação SINTÉTICA pelo portal',
          profissional: { nome: 'Profissional SINTÉTICO', conselho: 'CRM', numero: '905682', uf: 'SC' },
          internacao: null,
          itens: [{ tabela: 22, codigo: '40301630', descricao: null, quantidade: 1 }],
        },
        '127.0.0.9',
      );
      const doPortal = await autorizacoes.autorizacao({ rede: nucleo.rede, hospital: COD }, pedido.id);
      const meus = await portal.autorizacoesDoPrestador(sp, {}, '127.0.0.9');
      const pc = await portal.protocolo(sp, pedido.protocolo);
      const alheio = await codigoDe(portal.protocolo(sp, p1.protocolo));
      // W0-10 (9b-iii-d): as respostas do prestador com arquivos, na cópia. (a) Um protocolo de atendimento aberto pelo
      // canal do portal para o laboratório; a operadora interage; o prestador responde com um PDF; o anexo volta igual
      // (hash) e a resposta com o arquivo inválido é recusada. (b) O auditor pede complemento do pedido do portal; o
      // prestador responde com dois arquivos; ficam ligados ao evento da resposta e voltam iguais no download.
      const cAt = { rede: nucleo.rede, hospital: COD };
      const linhaW =
        (recurso: string, tabelaAlvo: string, operacao: string) =>
        (x: { id: number }): LinhaTrilha => ({
          rede: nucleo.rede,
          hospital: COD,
          usuario: USUARIO,
          evento: operacao,
          recurso,
          operacao,
          tabelaAlvo,
          idAlvo: String(x.id),
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'SGH-INTEGRACAO:w0-10',
          correlacao: 'integracao-w0-10',
          origem: 'SGH-INTEGRACAO:w0-10',
        });
      const xp = await new ServicoAtendimentoOperadora(porta, autorizacoes).conferirRegistro(
        cAt,
        esquemaRegistrarProtocoloOpe.parse({
          operadora: k.operadora,
          instancia: 'atendimento',
          natureza: 'informacao',
          canal: 'portal-prestador',
          origem: 1,
          solicitante: 'prestador',
          solicitanteNome: 'Laboratório SINTÉTICO M56.8',
          carteirinha,
          assunto: 'Dúvida SINTÉTICA do prestador',
          relato: 'Relato SINTÉTICO da dúvida do prestador pelo portal.',
        }),
        { prestador: lab.id },
      );
      let numeroPp = '';
      const pp = await porta.gravarSgh(
        cAt,
        linhaW('operadora.atendimento', 'SGH_OPE_PROTOCOLO', 'operadora.registrarProtocolo'),
        async (g) => {
          numeroPp = protocoloAtendimento(xp.registroAns, xp.registro.abertoEm, await g.proximoProtocolo());
          return g.registrar({ ...xp.registro, protocolo: numeroPp, usuario: USUARIO });
        },
      );
      await api.interagir(String(pp.id), { versao: 1, texto: 'Envie o laudo SINTÉTICO.' }, req);
      const cpp = await portal.protocolo(sp, numeroPp);
      const pdf = Buffer.from('%PDF-1.4\n% laudo sintetico\n%%EOF\n');
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        randomBytes(24),
      ]);
      const eventoOpe = cpp.tipo === 'atendimento' ? cpp.interacoes[0]!.evento : 0;
      const versaoPp = cpp.tipo === 'atendimento' ? (cpp.versao ?? 0) : 0;
      const anexoInvalido = await codigoDe(
        portal.responderInteracao(
          sp,
          pp.id,
          eventoOpe,
          {
            versao: versaoPp,
            texto: 'Arquivo SINTÉTICO que não é PDF',
            anexo: { nome: 'laudo.pdf', conteudo: Buffer.from('texto puro').toString('base64') },
          },
          '127.0.0.9',
        ),
      );
      const rpp = await portal.responderInteracao(
        sp,
        pp.id,
        eventoOpe,
        {
          versao: versaoPp,
          texto: 'Segue o laudo SINTÉTICO.',
          anexo: { nome: 'C:\\pasta\\laudo.pdf', conteudo: pdf.toString('base64') },
        },
        '127.0.0.9',
      );
      const respostasPp = await porta.respostasPrestador(cAt, pp.id);
      const baixadoPp = await portal.anexoDoProtocolo(sp, pp.id, respostasPp[0]!.id, '127.0.0.9');
      const cppDepois = await portal.protocolo(sp, numeroPp);
      const pedComp = await autorizacoes.gravarSgh(
        cAt,
        linhaW('operadora.autorizacao', 'SGH_OPE_AUTORIZACAO', 'operadora.pedirComplemento'),
        (g) =>
          g.pedirComplemento({
            id: pedido.id,
            versao: pedido.versao,
            pedido: 'Laudo SINTÉTICO anterior',
            usuario: USUARIO,
          }),
      );
      const rc = await portal.responderComplemento(
        sp,
        pedido.id,
        {
          versao: pedComp.versao,
          resposta: 'Laudos SINTÉTICOS anexos',
          anexos: [
            { nome: 'laudo.pdf', conteudo: pdf.toString('base64') },
            { nome: 'imagem.png', conteudo: png.toString('base64') },
          ],
        },
        '127.0.0.9',
      );
      const anexosAut = await autorizacoes.anexosDoComplemento(cAt, pedido.id);
      const baixadoAut = await portal.anexoDoComplemento(sp, pedido.id, anexosAut[1]!.id, '127.0.0.9');
      const situacaoAposComp = (await autorizacoes.autorizacao(cAt, pedido.id))?.situacao;
      const canc = await portal.cancelar(
        sp,
        pedido.id,
        { versao: rc.versao, motivo: 'Cancelamento SINTÉTICO pelo portal.' },
        '127.0.0.9',
      );
      // W0-10 (M7): a elegibilidade pelo portal, a da carteirinha do pedido e a de uma inexistente, cada uma registrada.
      const eleg = await portal.elegibilidade(sp, { carteirinha }, '127.0.0.9');
      const elegNao = await portal.elegibilidade(sp, { carteirinha: '1234' }, '127.0.0.9');
      const consultasEleg = await portal.consultasElegibilidade(sp);
      // W0-10: a troca da senha (a errada vai à trilha como falha) e a do autenticador (confirmada pelo app novo); a
      // entrada seguinte só com a senha nova e o código do app novo.
      const senhaNova = `${senha}N2`;
      const trocaErrada = await codigoDe(
        portal.trocarSenha(
          sp,
          { senhaAtual: `${senha}x`, codigo: codigoTotp(segredo, Date.now()), senhaNova },
          '127.0.0.9',
        ),
      );
      const trocaSenha = await portal.trocarSenha(
        sp,
        { senhaAtual: senha, codigo: codigoTotp(segredo, Date.now()), senhaNova },
        '127.0.0.9',
      );
      const ini = await portal.iniciarAutenticador(
        sp,
        { senha: senhaNova, codigo: codigoTotp(segredo, Date.now()) },
        '127.0.0.9',
      );
      const segredoNovo = new URL(ini.otpauth).searchParams.get('secret')!;
      const trocaAutenticador = await portal.confirmarAutenticador(
        sp,
        codigoTotp(segredoNovo, Date.now()),
        '127.0.0.9',
      );
      const entNova = await portal.entrar(
        COD,
        {
          login: 'responsavel@prestador.invalid',
          senha: senhaNova,
          codigo: codigoTotp(segredoNovo, Date.now()),
        },
        '127.0.0.9',
      );
      const ms = performance.now() - t0;

      return {
        p1,
        semFundamento,
        velha,
        escritaPrazo: fichaEscrita.escritaPrazoEm,
        textoEscrito: fichaEscrita.textoEscrito,
        encerrarAntes,
        e1,
        o1,
        fo,
        dupla,
        outra,
        ro,
        nip,
        cn,
        lista: lista.itens.map((x) => x.id),
        consulta,
        f1,
        naoLiberavel,
        trocaErrada,
        trocaSenha: trocaSenha.mensagem,
        trocaAutenticador: trocaAutenticador.mensagem,
        entNova: entNova.sessao.prestador,
        conta,
        contas: contas.itens.map((x) => ({ situacao: x.situacao, funcoes: x.funcoes })),
        reuso,
        errada,
        ent: ent.sessao,
        pedido,
        doPortal,
        meus: meus.itens.length,
        pc,
        alheio,
        canc,
        eleg,
        elegNao,
        consultasEleg: consultasEleg.itens.map((x) => [x.id, x.elegivel]),
        anexoInvalido,
        rpp,
        respostasPp,
        baixadoPp: {
          nome: baixadoPp.nome,
          tipo: baixadoPp.tipo,
          igual: baixadoPp.bytes.equals(pdf),
          sha256: baixadoPp.sha256,
        },
        cppDepois,
        rc,
        anexosAut,
        baixadoAut: { nome: baixadoAut.nome, tipo: baixadoAut.tipo, igual: baixadoAut.bytes.equals(png) },
        situacaoAposComp,
        sha256Pdf: createHash('sha256').update(pdf).digest('hex'),
        ms,
        escritas: (await escritasDaTransacao(e)).map((w) => w.tabela).sort(),
        trilhas: await contar(e),
      };
    });
    expect(r.p1.protocolo).toMatch(/^990568\d{14}$/);
    expect(r.semFundamento).toBe('fundamento-obrigatorio');
    expect(r.velha).toBe('protocolo-desatualizado');
    expect(r.escritaPrazo).not.toBeNull();
    // O número sai agrupado no texto (registro na ANS, data e sequência), e o fundamento sem ponto dobrado.
    expect(r.textoEscrito?.replace(/ /g, '')).toContain(r.p1.protocolo);
    expect(r.textoEscrito).toContain('Fundamento: Cláusula SINTÉTICA 7.\n');
    expect(r.encerrarAntes).toBe('escrita-pendente');
    expect(r.e1.situacao).toBe('encerrado');
    expect(r.o1.protocolo).toMatch(/^990568\d{14}$/);
    expect(r.fo).toMatchObject({ instancia: 'ouvidoria', origemProtocolo: { id: r.p1.id } });
    expect(r.dupla).toBe('reanalise-ja-aberta');
    expect(r.outra).toBe('prorrogacao-ja-feita');
    expect(r.ro.situacao).toBe('respondido');
    expect(r.nip.situacao).toBe('aberto');
    expect(r.cn.situacao).toBe('cancelado');
    expect(r.lista).toEqual([r.p1.id]);
    expect(r.consulta).toMatchObject({ tipo: 'atendimento', id: r.o1.id });
    expect(r.f1.reanalises.map((x) => x.id)).toEqual([r.o1.id]);
    expect(r.f1.eventos.map((x) => x.evento)).toEqual([
      'registro',
      'analise',
      'interacao',
      'resposta',
      'escrita-pedida',
      'escrita-enviada',
      'encerramento',
      'reanalise',
    ]);
    // Encerrado: nada além de outra reanálise (a da ouvidoria já respondida não fica em aberto).
    expect(r.f1.acoes.every((x) => x === 'reanalise')).toBe(true);
    expect(r.naoLiberavel).toBe('funcao-nao-liberavel');
    expect(r.conta.codigoAtivacao).toMatch(/^[A-Z0-9]{12}$/);
    expect(r.contas).toEqual([{ situacao: 'pendente', funcoes: [1, 2, 3, 7] }]);
    expect(r.reuso).toBe('ativacao-invalida');
    expect(r.errada).toBe('401');
    expect(r.ent).toMatchObject({ funcoes: [1, 2, 3, 7], prestadorNome: 'Laboratório SINTÉTICO M56.8' });
    expect(r.pedido.situacao).toBe('em-analise');
    expect(r.doPortal).toMatchObject({ origem: 4 });
    expect(r.meus).toBe(1);
    expect(r.pc).toMatchObject({ tipo: 'autorizacao', id: r.pedido.id });
    expect(r.alheio).toBe('protocolo-inexistente');
    expect(r.canc.situacao).toBe('cancelada');
    // W0-10 (M7): a elegibilidade registrada (a mais nova primeiro) com o beneficiário do pedido.
    expect(r.eleg.beneficiario).not.toBeNull();
    expect(r.eleg.cobertura).toHaveLength(4);
    expect(r.eleg.registro).toBeGreaterThan(0);
    expect(r.elegNao).toMatchObject({ elegivel: false, beneficiario: null });
    expect(r.consultasEleg.slice(0, 2)).toEqual([
      [r.elegNao.registro, false],
      [r.eleg.registro, r.eleg.elegivel],
    ]);
    // W0-10: a troca da senha e do autenticador do prestador.
    expect(r.trocaErrada).toBe('credencial-nao-confere');
    expect(r.trocaSenha).toMatch(/Senha trocada/);
    expect(r.trocaAutenticador).toMatch(/autenticador trocado/);
    expect(r.entNova).toBe(r.ent.prestador);
    // W0-10 (9b-iii-d): a resposta do protocolo com o PDF (nome sem caminho, hash) e a do complemento com 2 arquivos.
    expect(r.anexoInvalido).toBe('anexo-tipo');
    expect(r.rpp.ok).toBe(true);
    expect(r.respostasPp).toHaveLength(1);
    expect(r.respostasPp[0]).toMatchObject({
      prestador: r.ent.prestador,
      texto: 'Segue o laudo SINTÉTICO.',
      anexo: { nome: 'laudo.pdf', tipo: 'application/pdf', sha256: r.sha256Pdf },
    });
    expect(r.baixadoPp).toEqual({
      nome: 'laudo.pdf',
      tipo: 'application/pdf',
      igual: true,
      sha256: r.sha256Pdf,
    });
    expect(r.cppDepois).toMatchObject({ tipo: 'atendimento' });
    expect(
      r.cppDepois.tipo === 'atendimento' ? r.cppDepois.interacoes[0]?.respostas.map((x) => x.texto) : [],
    ).toEqual(['Segue o laudo SINTÉTICO.']);
    expect(r.rc).toMatchObject({ ok: true, anexos: 2 });
    expect(r.anexosAut.map((a) => [a.ordem, a.nome, a.evento])).toEqual([
      [1, 'laudo.pdf', r.rc.evento],
      [2, 'imagem.png', r.rc.evento],
    ]);
    expect(r.baixadoAut).toEqual({ nome: 'imagem.png', tipo: 'image/png', igual: true });
    expect(r.situacaoAposComp).toBe('em-analise');
    // Seção 5: só tabelas SGH_ (as da F1, F3 e F4 da carteira e do pedido sintéticos, as da F7 e a trilha).
    expect(r.escritas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.escritas).toEqual(
      expect.arrayContaining([
        'SGH_OPE_PROTOCOLO',
        'SGH_OPE_PROTOCOLO_EVT',
        'SGH_OPE_PORTAL_ACESSO',
        'SGH_OPE_PROT_RESPOSTA',
        'SGH_OPE_AUT_ANEXO',
        'SGH_OPE_ELEG_CONSULTA',
        'SGH_TRILHA',
      ]),
    );
    // Uma linha de trilha por gravação: no atendimento, 2 registros, análise, contato, resposta, escrita pedida e
    // enviada, encerramento, reanálise, prorrogação, a resposta da ouvidoria, cancelamento e a conta (13; as recusadas
    // não gravam); no portal, a ativação, as 2 entradas (a errada e a certa), a leitura auditada dos pedidos, o pedido e o
    // cancelamento (6); no W0-10, a troca errada (falha), a senha trocada, o autenticador trocado e a entrada nova (4);
    // na 9b-iii-d, o protocolo do prestador e a interação da operadora (+2 no atendimento), as 2 respostas e os 2
    // downloads do prestador (+4 no portal; a resposta recusada não grava); no M7, as 2 consultas de elegibilidade (+2).
    expect(r.trilhas.atendimento - antes.trilhas.atendimento).toBe(15);
    expect(r.trilhas.portal - antes.trilhas.portal).toBe(16);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[int-m56-8] ${COD}: ciclo F7 desfeito (atendimento respondido por escrito e encerrado, reanálise na ouvidoria prorrogada e respondida, NIP cancelada, conta do portal ativada, pedido pelo portal consultado e cancelado); recusas ${[r.semFundamento, r.velha, r.encerrarAntes, r.dupla, r.outra, r.naoLiberavel, r.reuso, r.alheio].join(', ')}; ${Math.round(r.ms)} ms; escritas só em SGH_ (${r.escritas.length} tabelas); trilha ${r.trilhas.atendimento - antes.trilhas.atendimento}+${r.trilhas.portal - antes.trilhas.portal}; ROLLBACK igual (${antes.protocolos} protocolos, ${antes.acessos} contas)`,
    );
  }, 120_000);
});
