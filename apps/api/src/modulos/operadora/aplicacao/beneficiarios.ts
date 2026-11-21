// Serviço da fatia F1 da operadora própria (M56.2; ficha, seções 4, 6, 7 e 8): a tela de beneficiários, planos e
// contratos e as gravações no banco do cliente (operadora_saude, produto_plano, contrato_plano, beneficiario_plano). Cada rota exige a chave da fatia (`operadora.beneficiarios`, que só vale com a
// do módulo; regra 1) e as regras puras de @sgh/dominio-operadora antes de gravar. A operadora de cada registro vem do
// banco, nunca do pedido: o contrato herda a do produto e o beneficiário, a do contrato (regra 3: a operadora é empresa
// distinta, e um registro de uma operadora não aponta para outra). Dado pessoal (CPF, nascimento, mãe) só na ficha, que
// é leitura auditada; a lista mostra o CPF mascarado. A ligação com o paciente do hospital é só o ID (regra 8).
import {
  type BeneficiarioEntrada,
  type BeneficiarioFicha,
  type BeneficiarioLista,
  type BeneficiariosOperadora,
  CHAVE_FATIA_BENEFICIARIOS,
  type ContratoEntrada,
  type ContratoOperadora,
  type ContratosOperadora,
  type Elegibilidade,
  type OperadoraEmpresa,
  type OperadoraEntrada,
  type ProdutoEntrada,
  type ProdutoOperadora,
  type TelaBeneficiarios,
} from '@sgh/contratos';
import {
  avaliarElegibilidade,
  carteirinhaValida,
  mascararCpfBeneficiario,
  mascararDocumentoContratante,
  nomeDeBusca,
  numeroCarteirinha,
  problemasDaBaixa,
  problemasDaOperadora,
  problemasDaReativacao,
  problemasDoBeneficiario,
  problemasDoContrato,
  problemasDoPedidoDeVia,
  problemasDaAlteracaoDoPlano,
  type ProblemaPlano,
  problemasDoPlano,
  validadeDaVia,
} from '@sgh/dominio-operadora';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro } from '../../cadastro/comum.js';
import type { GravadorOperadora, PortaOperadora } from '../porta.js';

// Os tipos de negócio da operadora, do produto, do contrato e do beneficiário são os da porta da F1 (lote da fatia
// de beneficiários): derivados da própria porta, para que este serviço acompanhe a forma que ela devolve.
type DadosOperadora = NonNullable<Awaited<ReturnType<PortaOperadora['operadora']>>>;
type DadosProduto = NonNullable<Awaited<ReturnType<PortaOperadora['produto']>>>;
type DadosContrato = NonNullable<Awaited<ReturnType<PortaOperadora['contrato']>>>;
type DadosBeneficiario = NonNullable<Awaited<ReturnType<PortaOperadora['beneficiario']>>>;
import {
  MENSAGENS_BAIXA,
  MENSAGENS_BENEFICIARIO,
  MENSAGENS_CARTEIRINHA,
  MENSAGENS_CONTRATO,
  MENSAGENS_OPERADORA_EMPRESA,
  MENSAGENS_PLANO,
  MENSAGENS_REATIVACAO,
  recusarSeHouver,
} from './mensagens.js';
import type { ServicoSituacaoOperadora } from './situacao.js';

const T = {
  operadora: 'operadora_saude',
  produto: 'produto_plano',
  contrato: 'contrato_plano',
  beneficiario: 'beneficiario_plano',
  carteirinha: 'cartao_beneficiario',
} as const;

const naoEncontrado = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, `${o} não existe nesta operadora.`);

/** Data de hoje (AAAA-MM-DD) no fuso do servidor. */
export function hojeLocal(agora = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

export const operadoraDto = (o: DadosOperadora): OperadoraEmpresa => ({
  id: o.id,
  registroAns: o.registroAns,
  cnpj: o.cnpj,
  razaoSocial: o.razaoSocial,
  nomeFantasia: o.nomeFantasia,
  modalidade: o.modalidade as OperadoraEmpresa['modalidade'],
  situacao: o.situacao === 'inativa' ? 'inativa' : 'ativa',
  versao: o.versao,
  alteradoEm: o.alteradoEm,
});

export const produtoDto = (p: DadosProduto): ProdutoOperadora => ({
  id: p.id,
  operadora: p.operadora,
  codigo: p.codigo,
  nome: p.nome,
  natureza: p.natureza,
  registroAns: p.registroAns,
  tipoContratacao: p.tipoContratacao,
  segmentacao: p.segmentacao,
  abrangencia: p.abrangencia,
  acomodacao: p.acomodacao,
  coparticipacao: p.coparticipacao,
  carencias: p.carencias,
  precos: p.precos ? [...p.precos] : null,
  situacao: p.situacao as ProdutoOperadora['situacao'],
  versao: p.versao,
  alteradoEm: p.alteradoEm,
});

export const contratoDto = (c: DadosContrato, mascarar: boolean): ContratoOperadora => ({
  id: c.id,
  operadora: c.operadora,
  produto: c.produto,
  produtoNome: c.produtoNome,
  numero: c.numero,
  tipo: c.tipo,
  tipoContratacao: c.tipoContratacao,
  contratanteNome: c.contratanteNome,
  contratanteDocumento: mascarar
    ? mascararDocumentoContratante(c.contratanteDocumento)
    : c.contratanteDocumento,
  formaReajuste: c.formaReajuste,
  mesReajuste: c.mesReajuste,
  tipoVigencia: c.tipoVigencia,
  inicio: c.inicio,
  fim: c.fim,
  diaVencimento: c.diaVencimento,
  situacao: c.situacao as ContratoOperadora['situacao'],
  motivoSituacao: c.motivoSituacao,
  beneficiariosAtivos: c.beneficiariosAtivos,
  versao: c.versao,
  alteradoEm: c.alteradoEm,
});

export const beneficiarioListaDto = (b: DadosBeneficiario): BeneficiarioLista => ({
  id: b.id,
  contrato: b.contrato,
  contratoNumero: b.contratoNumero,
  produtoNome: b.produtoNome,
  titular: b.titular,
  vinculo: b.vinculo,
  nome: b.nome,
  nomeSocial: b.nomeSocial,
  carteirinha: b.carteirinha,
  via: b.via,
  situacao: b.situacao,
  cpf: mascararCpfBeneficiario(b.cpf),
});

export class ServicoBeneficiariosOperadora {
  constructor(
    private readonly porta: PortaOperadora,
    private readonly situacoes: ServicoSituacaoOperadora,
  ) {}

  private sujeito(s: SessaoCadastro) {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: s.req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A chave da fatia (com a do módulo) vale para esta sessão? Senão, 403 com o motivo; nada é lido. */
  exigirFatia(s: SessaoCadastro): Promise<void> {
    return this.situacoes.exigir(this.sujeito(s), CHAVE_FATIA_BENEFICIARIOS);
  }

  private async gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvo: (r: T) => { tabela: string; id: string; chave: string },
    fn: (g: GravadorOperadora) => Promise<T>,
  ): Promise<T> {
    return this.porta
      .gravar(s.porta, (r: T) => linhaTrilha(s, evento, recurso, evento, alvo(r)), fn)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  async tela(s: SessaoCadastro): Promise<TelaBeneficiarios> {
    const situacao = await this.situacoes.situacao(this.sujeito(s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_FATIA_BENEFICIARIOS);
    const ligada = fatia?.situacao === 'ligada';
    const motivo = ligada ? null : (fatia?.motivo ?? situacao.modulo.motivo);
    if (!ligada)
      return {
        liberacao: { ligada: false, motivo },
        acoes: { editar: false, editarEmpresa: false, motivo },
        operadoras: [],
        produtos: [],
        dominios: { motivosBaixa: [], motivosSegundaVia: [], diasVencimento: [] },
      };
    const [operadoras, produtos, dominios] = await Promise.all([
      this.porta.operadoras(s.porta),
      this.porta.produtos(s.porta),
      this.porta.dominiosBeneficiario(s.porta),
    ]);
    const editar = s.pode('operadora.beneficiario.editar');
    return {
      liberacao: { ligada: true, motivo: null },
      acoes: {
        editar,
        editarEmpresa: s.pode('operadora.empresa.editar'),
        motivo: editar ? null : 'Seu perfil só consulta os beneficiários, planos e contratos.',
      },
      operadoras: operadoras.map(operadoraDto),
      produtos: produtos.map(produtoDto),
      dominios,
    };
  }

  // ── Operadora ───────────────────────────────────────────────────────────────────────────────────────────────

  async operadoras(s: SessaoCadastro): Promise<OperadoraEmpresa[]> {
    await this.exigirFatia(s);
    return (await this.porta.operadoras(s.porta)).map(operadoraDto);
  }

  async gravarOperadora(s: SessaoCadastro, id: number | null, e: OperadoraEntrada): Promise<{ id: number }> {
    await this.exigirFatia(s);
    recusarSeHouver(problemasDaOperadora(e), MENSAGENS_OPERADORA_EMPRESA, 'Operadora não gravada');
    if (id !== null && !(await this.porta.operadora(s.porta, id))) throw naoEncontrado('Operadora');
    return this.gravar(
      s,
      'operadora.empresa.gravada',
      'operadora.empresa.editar',
      (r) => ({ tabela: T.operadora, id: String(r.id), chave: `operadora:${r.id}` }),
      (g) =>
        g.gravarOperadora({
          id,
          versao: id === null ? null : (e.versao ?? -1),
          dados: {
            registroAns: e.registroAns,
            cnpj: e.cnpj,
            razaoSocial: e.razaoSocial,
            nomeFantasia: e.nomeFantasia ?? null,
            modalidade: e.modalidade,
            situacao: e.situacao,
          },
          por: s.login,
        }),
    );
  }

  // ── Produto ─────────────────────────────────────────────────────────────────────────────────────────────────

  async produtos(s: SessaoCadastro, operadora?: number): Promise<ProdutoOperadora[]> {
    await this.exigirFatia(s);
    return (await this.porta.produtos(s.porta, operadora)).map(produtoDto);
  }

  async gravarProduto(s: SessaoCadastro, id: number | null, e: ProdutoEntrada): Promise<{ id: number }> {
    await this.exigirFatia(s);
    const ope = await this.porta.operadora(s.porta, e.operadora);
    if (!ope) throw naoEncontrado('Operadora');
    let emUso: ProblemaPlano[] = [];
    if (id !== null) {
      const atual = await this.porta.produto(s.porta, id);
      // Regra 3: o produto não muda de operadora.
      if (!atual || atual.operadora !== e.operadora) throw naoEncontrado('Produto');
      // D-BAIXA-56: com contrato em uso, natureza, tipo de contratação e registro na ANS ficam como estão.
      const { contratosEmUso } = await this.porta.contagensDeUso(s.porta, { contrato: null, produto: id });
      emUso = problemasDaAlteracaoDoPlano(
        atual,
        {
          natureza: e.natureza,
          tipoContratacao: e.tipoContratacao,
          registroAns: e.natureza === 'plano' ? e.registroAns : null,
        },
        contratosEmUso,
      );
    }
    recusarSeHouver(
      [
        ...emUso,
        ...problemasDoPlano({
          natureza: e.natureza,
          registroAns: e.registroAns,
          segmentacao: e.segmentacao,
          abrangencia: e.abrangencia,
          acomodacao: e.acomodacao,
          coparticipacao: e.coparticipacao,
          carencias: e.carencias,
          precos: e.precos,
        }),
      ],
      MENSAGENS_PLANO,
      'Produto não gravado',
    );
    return this.gravar(
      s,
      'operadora.produto.gravado',
      'operadora.beneficiario.editar',
      (r) => ({ tabela: T.produto, id: String(r.id), chave: `operadora:${e.operadora};produto:${e.codigo}` }),
      (g) =>
        g.gravarProduto({
          id,
          versao: id === null ? null : (e.versao ?? -1),
          dados: {
            operadora: e.operadora,
            codigo: e.codigo,
            nome: e.nome,
            natureza: e.natureza,
            registroAns: e.natureza === 'plano' ? e.registroAns : null,
            tipoContratacao: e.tipoContratacao,
            segmentacao: e.segmentacao,
            abrangencia: e.abrangencia,
            acomodacao: e.acomodacao,
            coparticipacao: {
              tipo: e.coparticipacao.tipo,
              valor: e.coparticipacao.tipo === 1 ? null : e.coparticipacao.valor,
            },
            carencias: e.carencias,
            precos: e.precos,
            situacao: e.situacao,
          },
          por: s.login,
        }),
    );
  }

  // ── Contrato ────────────────────────────────────────────────────────────────────────────────────────────────

  /** A operadora do filtro: a pedida (que tem de existir) ou a primeira do estabelecimento. */
  private async operadoraDoFiltro(s: SessaoCadastro, pedida?: number): Promise<number | null> {
    if (pedida !== undefined) {
      if (!(await this.porta.operadora(s.porta, pedida))) throw naoEncontrado('Operadora');
      return pedida;
    }
    return (await this.porta.operadoras(s.porta))[0]?.id ?? null;
  }

  async contratos(
    s: SessaoCadastro,
    f: {
      operadora?: number | undefined;
      produto?: number | undefined;
      busca?: string | undefined;
      apos?: number | undefined;
    },
  ): Promise<ContratosOperadora> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDoFiltro(s, f.operadora);
    if (operadora === null) return { itens: [], proxima: null };
    const busca = f.busca?.trim();
    const r = await this.porta.contratos(s.porta, {
      operadora,
      ...(f.produto !== undefined ? { produto: f.produto } : {}),
      ...(busca && /^[\d\-./]+$/.test(busca) ? { numero: busca } : {}),
      ...(busca && !/^[\d\-./]+$/.test(busca) ? { nome: nomeDeBusca(busca) } : {}),
      ...(f.apos !== undefined ? { apos: f.apos } : {}),
    });
    return { itens: r.itens.map((c) => contratoDto(c, true)), proxima: r.proxima };
  }

  /** O contrato com o documento inteiro do contratante (leitura auditada pela rota). */
  async contrato(s: SessaoCadastro, id: number): Promise<ContratoOperadora> {
    await this.exigirFatia(s);
    const c = await this.porta.contrato(s.porta, id);
    if (!c) throw naoEncontrado('Contrato');
    return contratoDto(c, false);
  }

  async gravarContrato(s: SessaoCadastro, id: number | null, e: ContratoEntrada): Promise<{ id: number }> {
    await this.exigirFatia(s);
    const produto = await this.porta.produto(s.porta, e.produto);
    if (!produto) throw naoEncontrado('Produto');
    const atual = id === null ? null : await this.porta.contrato(s.porta, id);
    if (id !== null && (!atual || atual.operadora !== produto.operadora)) throw naoEncontrado('Contrato');
    const dominios = await this.porta.dominiosBeneficiario(s.porta);
    const { beneficiariosVinculados } =
      id === null
        ? { beneficiariosVinculados: 0 }
        : await this.porta.contagensDeUso(s.porta, { contrato: id, produto: null });
    recusarSeHouver(
      problemasDoContrato(
        {
          tipo: e.tipo,
          contratanteDocumento: e.contratanteDocumento,
          tipoVigencia: e.tipoVigencia,
          inicio: e.inicio,
          fim: e.fim,
          diaVencimento: e.diaVencimento,
          situacao: e.situacao,
          motivoSituacao: e.motivoSituacao ?? null,
        },
        {
          tipoContratacaoProduto: produto.tipoContratacao,
          situacaoProduto: produto.situacao as 'ativo',
          novo: id === null || atual?.produto !== produto.id,
          diasPermitidos: dominios.diasVencimento,
          beneficiariosAtivos: atual?.beneficiariosAtivos ?? 0,
          produto: produto.id,
          anterior: atual ? { produto: atual.produto, tipo: atual.tipo } : null,
          beneficiariosVinculados,
        },
      ),
      MENSAGENS_CONTRATO,
      'Contrato não gravado',
    );
    return this.gravar(
      s,
      'operadora.contrato.gravado',
      'operadora.beneficiario.editar',
      (r) => ({
        tabela: T.contrato,
        id: String(r.id),
        chave: `operadora:${produto.operadora};contrato:${e.numero}`,
      }),
      (g) =>
        g.gravarContrato({
          operadora: produto.operadora,
          id,
          versao: id === null ? null : (e.versao ?? -1),
          dados: {
            produto: produto.id,
            numero: e.numero,
            tipo: e.tipo,
            tipoContratacao: produto.tipoContratacao,
            contratanteNome: e.contratanteNome,
            contratanteBusca: nomeDeBusca(e.contratanteNome),
            contratanteDocumento: e.contratanteDocumento,
            formaReajuste: e.formaReajuste,
            mesReajuste: e.mesReajuste,
            tipoVigencia: e.tipoVigencia,
            inicio: e.inicio,
            fim: e.fim,
            diaVencimento: e.diaVencimento,
            situacao: e.situacao,
            motivoSituacao: e.situacao === 'ativo' ? null : (e.motivoSituacao ?? null),
          },
          por: s.login,
        }),
    );
  }

  // ── Beneficiário ────────────────────────────────────────────────────────────────────────────────────────────

  async beneficiarios(
    s: SessaoCadastro,
    f: {
      operadora?: number | undefined;
      contrato?: number | undefined;
      busca?: string | undefined;
      situacao?: string | undefined;
      apos?: number | undefined;
    },
  ): Promise<BeneficiariosOperadora> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDoFiltro(s, f.operadora);
    if (operadora === null) return { itens: [], proxima: null };
    const b = f.busca?.trim() ?? '';
    const digitos = b.replace(/[\s.\-/]/g, '');
    const porCarteirinha = /^\d{16}$/.test(digitos);
    const porCpf = /^\d{11}$/.test(digitos);
    const r = await this.porta.beneficiarios(s.porta, {
      operadora,
      ...(f.contrato !== undefined ? { contrato: f.contrato } : {}),
      ...(porCarteirinha ? { carteirinha: digitos } : {}),
      ...(porCpf ? { cpf: digitos } : {}),
      ...(b && !porCarteirinha && !porCpf ? { nome: nomeDeBusca(b) } : {}),
      ...(f.situacao ? { situacao: f.situacao } : {}),
      ...(f.apos !== undefined ? { apos: f.apos } : {}),
    });
    return { itens: r.itens.map(beneficiarioListaDto), proxima: r.proxima };
  }

  async ficha(s: SessaoCadastro, id: number): Promise<BeneficiarioFicha> {
    await this.exigirFatia(s);
    const b = await this.porta.beneficiario(s.porta, id);
    if (!b) throw naoEncontrado('Beneficiário');
    const [dependentes, vias, ope] = await Promise.all([
      b.titular === null ? this.porta.dependentes(s.porta, b.id) : Promise.resolve([]),
      this.porta.vias(s.porta, b.id),
      this.porta.operadora(s.porta, b.operadora),
    ]);
    return {
      ...beneficiarioListaDto(b),
      cpf: b.cpf,
      nascimento: b.nascimento,
      sexo: b.sexo as BeneficiarioFicha['sexo'],
      cns: b.cns,
      nomeMae: b.nomeMae,
      inclusao: b.inclusao,
      exclusao: b.exclusao,
      motivoBaixa: b.motivoBaixa,
      pacienteHospital: b.pacienteHospital,
      operadora: b.operadora,
      registroAnsOperadora: ope?.registroAns ?? '',
      dependentes: dependentes.map(beneficiarioListaDto),
      carteirinhas: vias.map((v) => ({
        via: v.via,
        motivo: v.motivo,
        validade: v.validade,
        emitidaPor: v.emitidaPor,
        emitidaEm: v.emitidaEm,
      })),
      versao: b.versao,
      alteradoEm: b.alteradoEm,
    };
  }

  async gravarBeneficiario(
    s: SessaoCadastro,
    id: number | null,
    e: BeneficiarioEntrada,
  ): Promise<{ id: number; carteirinha?: string }> {
    await this.exigirFatia(s);
    const contrato = await this.porta.contrato(s.porta, e.contrato);
    if (!contrato) throw naoEncontrado('Contrato');
    const atual = id === null ? null : await this.porta.beneficiario(s.porta, id);
    // O beneficiário não muda de contrato (a mudança de plano é baixa e nova adesão).
    if (id !== null && (!atual || atual.contrato !== contrato.id)) throw naoEncontrado('Beneficiário');
    const titular = e.titular === null ? null : await this.porta.beneficiario(s.porta, e.titular);
    const contagens = await this.porta.contagensDoContrato(s.porta, {
      contrato: contrato.id,
      cpf: e.cpf,
      exceto: id,
    });
    recusarSeHouver(
      problemasDoBeneficiario(
        {
          id,
          vinculo: e.vinculo,
          titular: e.titular,
          cpf: e.cpf,
          cns: e.cns,
          nascimento: e.nascimento,
          inclusao: e.inclusao,
        },
        {
          hoje: hojeLocal(),
          contrato: {
            id: contrato.id,
            tipo: contrato.tipo,
            situacao: contrato.situacao as 'ativo',
            inicio: contrato.inicio,
            fim: contrato.fim,
          },
          titular: titular
            ? {
                id: titular.id,
                contrato: titular.contrato,
                vinculo: titular.vinculo,
                situacao: titular.situacao,
              }
            : null,
          outrosTitularesAtivos: contagens.titularesAtivos,
          cpfNoContrato: contagens.cpfNoContrato,
        },
      ),
      MENSAGENS_BENEFICIARIO,
      'Beneficiário não gravado',
    );
    // Regra 8: a ligação com o paciente do hospital só pelo ID, conferido pela existência (nenhum dado dele).
    if (e.pacienteHospital !== null && !(await this.porta.pacienteExiste(s.porta, e.pacienteHospital)))
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Beneficiário não gravado',
        'Não há paciente do hospital com este número de cadastro.',
        { codigo: 'paciente-inexistente', campos: ['pacienteHospital'] },
      );
    const dados = {
      contrato: contrato.id,
      titular: e.titular,
      vinculo: e.vinculo,
      nome: e.nome,
      nomeBusca: nomeDeBusca(e.nome),
      nomeSocial: e.nomeSocial ?? null,
      cpf: e.cpf,
      nascimento: e.nascimento,
      sexo: e.sexo,
      cns: e.cns,
      nomeMae: e.nomeMae,
      inclusao: e.inclusao,
      pacienteHospital: e.pacienteHospital,
    };
    const chave = `operadora:${contrato.operadora};contrato:${contrato.numero}`;
    if (id !== null)
      return this.gravar(
        s,
        'operadora.beneficiario.gravado',
        'operadora.beneficiario.editar',
        (r) => ({ tabela: T.beneficiario, id: String(r.id), chave: `${chave};alteracao` }),
        (g) => g.alterarBeneficiario({ id, versao: e.versao ?? -1, dados, por: s.login }),
      );
    const ope = await this.porta.operadora(s.porta, contrato.operadora);
    if (!ope) throw naoEncontrado('Operadora');
    const validade = validadeDaVia(hojeLocal(), contrato.tipoVigencia === 1 ? contrato.fim : null);
    let carteirinha = '';
    const r = await this.gravar(
      s,
      'operadora.beneficiario.gravado',
      'operadora.beneficiario.editar',
      (x) => ({ tabela: T.beneficiario, id: String(x.id), chave: `${chave};inclusao` }),
      async (g) => {
        carteirinha = numeroCarteirinha(ope.registroAns, await g.proximaSequenciaCarteirinha());
        return g.incluirBeneficiario({
          operadora: contrato.operadora,
          dados,
          carteirinha,
          validade,
          por: s.login,
        });
      },
    );
    return { id: r.id, carteirinha };
  }

  async baixar(
    s: SessaoCadastro,
    id: number,
    e: { motivo: number; data: string; versao: number },
  ): Promise<{ id: number; dependentes: number }> {
    await this.exigirFatia(s);
    const b = await this.porta.beneficiario(s.porta, id);
    if (!b) throw naoEncontrado('Beneficiário');
    const dominios = await this.porta.dominiosBeneficiario(s.porta);
    recusarSeHouver(
      problemasDaBaixa(b, e, {
        motivosValidos: dominios.motivosBaixa.map((m) => m.codigo),
        hoje: hojeLocal(),
      }),
      MENSAGENS_BAIXA,
      'Exclusão não feita',
    );
    return this.gravar(
      s,
      'operadora.beneficiario.gravado',
      'operadora.beneficiario.editar',
      (r) => ({
        tabela: T.beneficiario,
        id: String(r.id),
        chave: `contrato:${b.contratoNumero};baixa;motivo:${e.motivo};dependentes:${r.dependentes}`,
      }),
      (g) => g.baixarBeneficiario({ id, versao: e.versao, motivo: e.motivo, data: e.data, por: s.login }),
    );
  }

  async reativar(s: SessaoCadastro, id: number, versao: number): Promise<{ id: number }> {
    await this.exigirFatia(s);
    const b = await this.porta.beneficiario(s.porta, id);
    if (!b) throw naoEncontrado('Beneficiário');
    const contrato = await this.porta.contrato(s.porta, b.contrato);
    const titular = b.titular === null ? null : await this.porta.beneficiario(s.porta, b.titular);
    recusarSeHouver(
      problemasDaReativacao(b, {
        contratoAtivo: contrato?.situacao === 'ativo',
        titularAtivo: titular?.situacao === 'ativo',
      }),
      MENSAGENS_REATIVACAO,
      'Reativação não feita',
    );
    return this.gravar(
      s,
      'operadora.beneficiario.gravado',
      'operadora.beneficiario.editar',
      (r) => ({ tabela: T.beneficiario, id: String(r.id), chave: `contrato:${b.contratoNumero};reativacao` }),
      (g) => g.reativarBeneficiario({ id, versao, por: s.login }),
    );
  }

  /** Segunda via (e as seguintes) da carteirinha, com o motivo; a primeira sai na inclusão. */
  async emitirVia(
    s: SessaoCadastro,
    id: number,
    e: { motivo: number | null; versao: number },
  ): Promise<{ id: number; via: number }> {
    await this.exigirFatia(s);
    const b = await this.porta.beneficiario(s.porta, id);
    if (!b) throw naoEncontrado('Beneficiário');
    const dominios = await this.porta.dominiosBeneficiario(s.porta);
    recusarSeHouver(
      problemasDoPedidoDeVia(
        { situacao: b.situacao, viasEmitidas: b.via },
        e.motivo,
        dominios.motivosSegundaVia.map((m) => m.codigo),
      ),
      MENSAGENS_CARTEIRINHA,
      'Via não emitida',
    );
    const contrato = await this.porta.contrato(s.porta, b.contrato);
    const validade = validadeDaVia(hojeLocal(), contrato?.tipoVigencia === 1 ? contrato.fim : null);
    return this.gravar(
      s,
      'operadora.carteirinha.emitida',
      'operadora.beneficiario.editar',
      (r) => ({ tabela: T.carteirinha, id: String(r.id), chave: `via:${r.via};motivo:${e.motivo}` }),
      (g) => g.emitirVia({ id, versao: e.versao, motivo: e.motivo as number, validade, por: s.login }),
    );
  }

  // ── Elegibilidade ───────────────────────────────────────────────────────────────────────────────────────────

  async elegibilidade(s: SessaoCadastro, carteirinha: string, data?: string): Promise<Elegibilidade> {
    await this.exigirFatia(s);
    const dia = data ?? hojeLocal();
    const linha = carteirinhaValida(carteirinha)
      ? await this.porta.elegibilidade(s.porta, carteirinha)
      : null;
    const r = avaliarElegibilidade(
      carteirinha,
      linha
        ? {
            beneficiario: { situacao: linha.beneficiario.situacao, inclusao: linha.beneficiario.inclusao },
            contrato: {
              situacao: linha.contrato.situacao as 'ativo',
              inicio: linha.contrato.inicio,
              fim: linha.contrato.fim,
            },
            produto: {
              situacao: linha.produto.situacao as 'ativo',
              natureza: linha.produto.natureza,
              carencias: linha.produto.carencias,
            },
          }
        : null,
      dia,
    );
    return {
      carteirinha,
      data: dia,
      elegivel: r.elegivel,
      motivos: r.motivos,
      beneficiario: linha
        ? {
            id: linha.beneficiario.id,
            nome: linha.beneficiario.nomeSocial ?? linha.beneficiario.nome,
            situacao: linha.beneficiario.situacao,
          }
        : null,
      plano: linha
        ? {
            nome: linha.produto.nome,
            registroAns: linha.produto.registroAns,
            natureza: linha.produto.natureza,
            segmentacao: linha.produto.segmentacao,
            abrangencia: linha.produto.abrangencia,
            acomodacao: linha.produto.acomodacao,
          }
        : null,
      carencias: r.carencias,
    };
  }
}
