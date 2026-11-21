// Telas de profissionais, solicitantes, pessoas e especialidades do M11 (ficha, seção 7); a inclusão do solicitante
// externo entra na onda 1 (revisão do M39) e a inclusão e a edição do profissional na D-PROF-39 (liberação full):
//   GET /api/cadastros/profissionais/opcoes                  listas dos combos da edição
//   POST /api/cadastros/profissionais                        inclusão (cadastro.profissional.criar)
//   PUT /api/cadastros/profissionais/:id                     dados (cadastro.profissional.editar, versão lida)
//   POST|PUT /api/cadastros/profissionais/:id/registros[/:r] registro novo; ativar, inativar (motivo e a permissão de
//                                     inativar), conselho e sigla
//   PUT /api/cadastros/profissionais/:id/{especialidades,lotacao,credenciamentos}  do registro do profissional
//   GET /api/cadastros/profissionais/logins                  logins que podem ser ligados (gestão de acessos)
//   PUT /api/cadastros/profissionais/:id/login               liga, troca ou desliga o login do registro (gestão de
//                                     acessos, senha de novo, justificativa; ninguém mexe no próprio login)
//   POST /api/cadastros/profissionais/:id/{inativar,reativar} com o motivo (cadastro.profissional.excluir)
//   GET /api/cadastros/profissionais/:id/vinculos[?registro] o que impede a exclusão (quantos e quais)
//   POST /api/cadastros/profissionais/:id[/registros/:r]/excluir  só sem vínculo, senha de novo, retrato antes
//   GET /api/cadastros/profissionais/:id/eventos             histórico do login e da situação
//   GET /api/cadastros/profissionais?termo&ativos            lista (nome pela chave normalizada; registro e CBO;
//                                     conselho + UF + número por `conselho`, `uf`, `numero` ou "CRM 12345 SP")
//   GET /api/cadastros/profissionais/:id                     ficha (registros, especialidades, lotação, credenciamentos, logins)
//   GET /api/cadastros/profissionais/:id/historico           histórico (HTPROFIS)
//   GET /api/cadastros/solicitantes?termo                     solicitantes externos (duplicados e incompletos
//                                     marcados; nome pela chave normalizada ou conselho + UF + número)
//   POST /api/cadastros/solicitantes                          revisão do M39 (onda 1): inclusão do solicitante externo
//                                     pelo executor (cadastro.cadastrarSolicitante; deduplicação por conselho + UF +
//                                     número; a trilha na transação, na memória pelo registrador da API)
//   GET /api/cadastros/pessoas?documento                      pessoas por CPF ou CNPJ e onde são usadas
//   GET /api/cadastros/especialidades/:cod/procedimentos     procedimentos por especialidade (paginado no servidor)
//   GET /api/cadastros/conselhos/siglas                       siglas válidas por conselho
// Dados bancários e de repasse do profissional nunca saem (regra 11). Situação do TBPROFIS com a legenda
// "a confirmar" (DP-46.1); a atividade real é a do registro (TBCBOPRO.ATIVO).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type DependenciasProfissional,
  type EventoProfissional,
  esquemaAlterarProfissional,
  esquemaExcluirProfissional,
  esquemaExcluirRegistroProfissional,
  esquemaSituacaoProfissional,
  esquemaVincularLoginProfissional,
  type LoginsProfissional,
  esquemaAlterarRegistroProfissional,
  esquemaCadastrarProfissional,
  esquemaCredenciamentoProfissional,
  esquemaEspecialidadeProfissional,
  esquemaIncluirRegistroProfissional,
  esquemaIncluirSolicitante,
  esquemaLotacaoProfissional,
  type OpcoesProfissional,
  type ProfissionalGravado,
  type RegistroProfissionalGravado,
  EVENTOS_AUDITAVEIS,
  type FichaProfissional,
  PERMISSOES_ACESSO,
  type HistoricoProfissional,
  type ListaPessoas,
  type ListaProfissionais,
  type ListaSolicitantes,
  type ProcedimentosEspecialidade,
  type ProfissionalResumo,
  type SiglasConselho,
  type SolicitanteIncluido,
} from '@sgh/contratos';
import {
  casaPalavras,
  categoriaDoProfissional,
  categoriaPorCbo,
  chaveFonetica,
  formatarCpf,
  type CampoHistorico,
  incompleto,
  mascararCpf,
  mascararTelefone,
  mudancasEntreVersoes,
  palavraMaisSeletiva,
  palavrasDoCadastro,
  palavrasDoTermo,
  permissoesDaFicha,
  profissionalAtivo,
  sugerirFoneticos,
  termoIdentifica,
} from '@sgh/dominio-cadastro';
import type { ProfissionalCadastro } from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { PORTA_ONDA0, type PortaOnda0 } from '../config/public-api.js';
import { contextoOperacao, exigir, idDaRota, pagina, problemaDoCadastro, sessaoDe } from './comum.js';
import { PORTA_CADASTRO, type PortaCadastro } from './porta.js';
import {
  OPERACOES_PROFISSIONAL_CRITICAS,
  OPERACOES_PROFISSIONAL_TELA,
  type OperacaoProfissionalTela,
} from './profissionais-memoria.js';
import type { z } from 'zod';

const POR_PAGINA = 50;

/**
 * Revisão da D-PROF-39: ligar, trocar e desligar o login do profissional é conceder a identidade clínica (com o
 * vínculo o login prescreve e assina com o registro do profissional): exige a gestão de acessos (a mesma permissão
 * que concede papéis em TBUSERS_TBPAPEL), não a de editar o cadastro.
 */
export const PERMISSAO_VINCULO_LOGIN = PERMISSOES_ACESSO.perfilGerir;

export function resumoDoProfissional(p: ProfissionalCadastro): ProfissionalResumo {
  const registros = p.registros.map((r) => ({
    id: r.id,
    conselho: r.conselho,
    sigla: r.sigla,
    numero: r.numero,
    uf: r.uf,
    cbo: r.cbo,
    cboDescricao: r.cboDescricao,
    categoria: categoriaPorCbo(r.cbo),
    ativo: r.ativo,
  }));
  return {
    id: p.id,
    nome: p.nome,
    categoria: categoriaDoProfissional(p.registros),
    registros,
    situacaoLegado: { codigo: p.situacao, aConfirmar: true },
    ativo: profissionalAtivo(p.registros),
  };
}

const CAMPOS_HISTORICO_PROFISSIONAL: readonly CampoHistorico[] = [
  { coluna: 'nome', campo: 'nome', rotulo: 'Nome' },
  { coluna: 'nomeSocial', campo: 'nomeSocial', rotulo: 'Nome social' },
  { coluna: 'nascimento', campo: 'nascimento', rotulo: 'Nascimento' },
  { coluna: 'sexo', campo: 'sexo', rotulo: 'Sexo' },
  { coluna: 'nomeMae', campo: 'nomeMae', rotulo: 'Nome da mãe' },
  { coluna: 'nomePai', campo: 'nomePai', rotulo: 'Nome do pai' },
  { coluna: 'documento', campo: 'documento', rotulo: 'CPF/CNPJ', restricao: 'documento' },
  { coluna: 'cns', campo: 'cns', rotulo: 'CNS', restricao: 'documento' },
  { coluna: 'email', campo: 'email', rotulo: 'E-mail' },
  { coluna: 'cep', campo: 'cep', rotulo: 'CEP' },
  { coluna: 'logradouro', campo: 'logradouro', rotulo: 'Logradouro' },
  { coluna: 'numero', campo: 'numero', rotulo: 'Número' },
  { coluna: 'complemento', campo: 'complemento', rotulo: 'Complemento' },
  { coluna: 'bairro', campo: 'bairro', rotulo: 'Bairro' },
  { coluna: 'cidade', campo: 'cidade', rotulo: 'Cidade' },
  { coluna: 'uf', campo: 'uf', rotulo: 'UF' },
  { coluna: 'racaCor', campo: 'racaCor', rotulo: 'Raça/cor', restricao: 'sensivel' },
  { coluna: 'etnia', campo: 'etnia', rotulo: 'Etnia', restricao: 'sensivel' },
];

/** Registro no conselho pedido: `numero` (e `conselho`, `uf`) ou o termo "CRM 12345 SP", "12345/SP", "12345". */
export function registroDaConsulta(
  q: Record<string, string>,
): { numero: number; conselho: string | null; uf: string | null } | null {
  const sigla = (v: string | undefined, max: number) => {
    const t = (v ?? '').trim().toUpperCase();
    return new RegExp(`^[A-Z]{2,${max}}$`).test(t) ? t : null;
  };
  const n = (q['numero'] ?? '').trim();
  if (/^\d{1,9}$/.test(n))
    return { numero: Number(n), conselho: sigla(q['conselho'], 8), uf: sigla(q['uf'], 2) };
  const m = /^(?:([A-Za-z]{2,8})[\s-]*)?(\d{2,9})(?:\s*[-/\s]\s*([A-Za-z]{2}))?$/.exec(
    (q['termo'] ?? '').trim().slice(0, 40),
  );
  if (!m) return null;
  return {
    numero: Number(m[2]),
    conselho: m[1] ? m[1].toUpperCase() : null,
    uf: m[3] ? m[3].toUpperCase() : null,
  };
}

@Controller('cadastros')
export class ProfissionaisController {
  constructor(
    @Inject(PORTA_CADASTRO) private readonly porta: PortaCadastro,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(PORTA_ONDA0) private readonly onda0: PortaOnda0 | null = null,
  ) {}

  @Get('profissionais')
  @Permissao('cadastro.profissional.ler')
  async profissionais(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaProfissionais> {
    const s = sessaoDe(req);
    const reg = registroDaConsulta(q);
    const termo = reg ? '' : (q['termo'] ?? '').slice(0, 100);
    const soAtivos = q['ativos'] !== 'nao';
    try {
      let lista: ProfissionalCadastro[];
      let sugestoes: ProfissionalCadastro[] = [];
      if (reg)
        // Conselho + UF + número (ficha §4); conselho e UF quando informados (lista curta: 871 no pc).
        lista = (await this.porta.listarProfissionais(s.porta)).filter((p) =>
          p.registros.some(
            (r) =>
              r.numero === reg.numero &&
              (!reg.conselho ||
                r.conselho?.toUpperCase() === reg.conselho ||
                r.sigla?.toUpperCase() === reg.conselho) &&
              (!reg.uf || r.uf?.toUpperCase() === reg.uf),
          ),
        );
      else if (termo.trim() === '') lista = await this.porta.listarProfissionais(s.porta);
      else {
        const palavras = palavrasDoTermo(termo);
        if (!termoIdentifica(palavras))
          throw new ErroProblema(
            'entrada-invalida',
            400,
            'Termo de busca inválido',
            'Digite ao menos uma palavra de duas letras.',
          );
        const maior = palavraMaisSeletiva(palavras) as string;
        const ids = await this.porta.idsPorPalavra(s.porta, 'profissional', ['nome', 'social'], maior);
        lista = (await this.porta.listarProfissionais(s.porta, [...ids.ids])).filter((p) =>
          [p.nome, p.nomeSocial].some((n) => casaPalavras(palavras, palavrasDoCadastro(n))),
        );
        if (lista.length === 0) {
          const f = await this.porta.idsPorFonetica(
            s.porta,
            'profissional',
            ['nome', 'social'],
            chaveFonetica(maior),
          );
          sugestoes = sugerirFoneticos(
            termo,
            await this.porta.listarProfissionais(s.porta, [...f.ids]),
            (x) => x.nome,
          );
        }
      }
      const filtrada = lista.map(resumoDoProfissional).filter((p) => !soAtivos || p.ativo);
      return {
        itens: filtrada.slice(0, 500),
        truncado: filtrada.length > 500,
        sugestoes: sugestoes.map(resumoDoProfissional),
      };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  /** D-PROF-39: as listas dos combos da inclusão e da edição (conselhos, siglas, CBO, especialidades, unidades, convênios). */
  @Get('profissionais/opcoes')
  @Permissao('cadastro.profissional.ler')
  async opcoesProfissional(@Req() req: RequisicaoAutorizada): Promise<OpcoesProfissional> {
    const s = sessaoDe(req);
    const o = await this.porta.opcoesProfissional(s.porta);
    return {
      conselhos: [...o.conselhos],
      siglas: [...o.siglas],
      cbos: [...o.cbos],
      especialidades: [...o.especialidades],
      unidades: [...o.unidades],
      convenios: [...o.convenios],
      ufs: [...o.ufs],
    };
  }

  /** D-PROF-39: os logins que podem ser ligados (ativos, com o papel Operador de sistema), para o combo com busca. */
  @Get('profissionais/logins')
  @Permissao(PERMISSAO_VINCULO_LOGIN)
  async loginsProfissional(@Req() req: RequisicaoAutorizada): Promise<LoginsProfissional> {
    const s = sessaoDe(req);
    try {
      return (await this.porta.loginsProfissional(s.porta)).map((x) => ({ ...x }));
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('profissionais/:id')
  @Permissao('cadastro.profissional.ler')
  @Auditar('cadastro.profissional.lido')
  async profissional(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaProfissional> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const f = await this.porta.fichaProfissional(s.porta, n);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Profissional não encontrado');
    req.sghAlvo = { tabelaAlvo: 'TBPROFIS', idAlvo: String(n) };
    const resumo = resumoDoProfissional(f);
    // D-PROF-39: quem edita recebe os dados editáveis e as versões do controle otimista (sem documento; regra 11).
    const editar = s.pode('cadastro.profissional.editar');
    const dados = editar ? await this.porta.dadosProfissional(s.porta, n) : null;
    // O login de cada registro (a versão do vínculo) para quem edita ou gere acessos.
    const loginsRegistro =
      editar || s.pode(PERMISSAO_VINCULO_LOGIN)
        ? (await this.porta.loginsDosRegistros(s.porta, n)).map((x) => ({ ...x }))
        : null;
    // Revisão da D-PROF-39: o que o executor aceitaria para quem pergunta (a mesma regra da faixa da onda 0).
    const operacoes = this.onda0
      ? await Promise.all(
          OPERACOES_PROFISSIONAL_TELA.map(async (operacao) => ({
            operacao,
            ligada: await this.onda0!.podeEscrever(s.rede, s.hospital, s.login, operacao).catch(() => false),
          })),
        )
      : null;
    return {
      ...resumo,
      registros: editar
        ? resumo.registros.map((r) => {
            const lido = f.registros.find((x) => x.id === r.id);
            return { ...r, siglaId: lido?.siglaId ?? null, versao: lido?.versao ?? '' };
          })
        : resumo.registros,
      nomeSocial: f.nomeSocial,
      especialidades: [...f.especialidades],
      lotacao: [...f.lotacao],
      credenciamentos: [...f.credenciamentos],
      logins: [...f.logins],
      ...(dados ? { dados: { ...dados } } : {}),
      ...(loginsRegistro ? { loginsRegistro } : {}),
      ...(operacoes ? { operacoes } : {}),
    };
  }

  /** D-PROF-39: inclui o profissional com o registro no conselho, o CBO e o credenciamento (pelo executor). */
  @Post('profissionais')
  @HttpCode(201)
  @Permissao('cadastro.profissional.criar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async incluirProfissional(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProfissionalGravado> {
    const r = await this.gravar(
      req,
      'cadastro.cadastrarProfissional',
      esquemaCadastrarProfissional,
      corpo,
      null,
    );
    return { profissional: r['profissional'] ?? 0, registro: r['registro'] ?? 0 };
  }

  /** D-PROF-39: altera os dados do profissional (só o que mudou; versão lida pela ficha). */
  @Put('profissionais/:id')
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async alterarProfissional(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ profissional: number }> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    await this.gravar(
      req,
      'cadastro.alterarProfissional',
      esquemaAlterarProfissional,
      { ...c, profissional: n },
      n,
    );
    return { profissional: n };
  }

  /** D-PROF-39: outro registro (conselho, número, UF, CBO) para o profissional. */
  @Post('profissionais/:id/registros')
  @HttpCode(201)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async incluirRegistro(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    const r = await this.gravar(
      req,
      'cadastro.incluirRegistroProfissional',
      esquemaIncluirRegistroProfissional,
      { ...c, profissional: n },
      n,
    );
    return { registro: r['registro'] ?? 0 };
  }

  /** D-PROF-39: ativa ou inativa o registro e corrige o conselho e a sigla. */
  @Put('profissionais/:id/registros/:registro')
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async alterarRegistro(
    @Param('id') id: string,
    @Param('registro') registro: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    const n = idDaRota(id);
    const reg = idDaRota(registro);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    // Revisão da D-PROF-39: encerrar ou reativar o registro é inativar (ou reativar) parte do profissional: exige a
    // mesma permissão de inativar e reativar o profissional (cadastro.profissional.excluir), não só a de editar.
    const alteracoes = c['alteracoes'];
    if (alteracoes && typeof alteracoes === 'object' && 'ativo' in alteracoes)
      await exigir(sessaoDe(req), 'cadastro.profissional.excluir', this.trilha);
    await this.gravar(
      req,
      'cadastro.alterarRegistroProfissional',
      esquemaAlterarRegistroProfissional,
      { ...c, registro: reg },
      n,
      reg,
    );
    return { registro: reg };
  }

  /** D-PROF-39: especialidade do registro (incluir ou mudar a situação). */
  @Put('profissionais/:id/especialidades')
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async especialidade(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    return this.gravarDoRegistro(
      req,
      id,
      corpo,
      'cadastro.definirEspecialidadeProfissional',
      esquemaEspecialidadeProfissional,
    );
  }

  /** D-PROF-39: lotação do registro numa unidade com a carga horária. */
  @Put('profissionais/:id/lotacao')
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async lotacao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    return this.gravarDoRegistro(req, id, corpo, 'cadastro.lotarProfissional', esquemaLotacaoProfissional);
  }

  /** D-PROF-39: credenciar ou descredenciar o registro num convênio. */
  @Put('profissionais/:id/credenciamentos')
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async credenciamento(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    return this.gravarDoRegistro(
      req,
      id,
      corpo,
      'cadastro.credenciarProfissional',
      esquemaCredenciamentoProfissional,
    );
  }

  /** D-PROF-39: o histórico do vínculo com o login e da situação (quem, quando, o quê e o motivo). */
  @Get('profissionais/:id/eventos')
  @Permissao('cadastro.profissional.ler')
  async eventosProfissional(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EventoProfissional[]> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    try {
      return (await this.porta.eventosProfissional(s.porta, n)).map((x) => ({
        ...x,
        evento: x.evento as EventoProfissional['evento'],
      }));
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  /** D-PROF-39: o que depende do profissional (ou do registro, com ?registro=): vazio, a exclusão é permitida. */
  @Get('profissionais/:id/vinculos')
  @Permissao('cadastro.profissional.excluir')
  async vinculosProfissional(
    @Param('id') id: string,
    @Query('registro') registro: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DependenciasProfissional> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const reg = registro === undefined ? undefined : idDaRota(registro);
    const f = await this.porta.fichaProfissional(s.porta, n);
    if (!f || (reg !== undefined && !f.registros.some((r) => r.id === reg)))
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    try {
      const v = await this.porta.vinculosProfissional(s.porta, n, reg);
      const total = v.reduce((t, x) => t + x.quantidade, 0);
      return { total, vinculos: v.map((x) => ({ ...x })), podeExcluir: total === 0 };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  /**
   * D-PROF-39: liga, troca ou desliga o login do registro (senha de novo; sempre com a justificativa). Revisão: exige a
   * gestão de acessos (o vínculo é a identidade clínica) e ninguém mexe no próprio login (recusa a-si-mesmo).
   */
  @Put('profissionais/:id/login')
  @Permissao(PERMISSAO_VINCULO_LOGIN)
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async vincularLogin(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ registro: number; semRegistroAtivo: boolean }> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    const reg = typeof c['registro'] === 'number' ? c['registro'] : undefined;
    const r = await this.gravar(
      req,
      'cadastro.vincularLoginProfissional',
      esquemaVincularLoginProfissional,
      { ...c, profissional: n },
      n,
      reg,
    );
    return { registro: r['registro'] ?? 0, semRegistroAtivo: (r['semRegistroAtivo'] ?? 0) === 1 };
  }

  /** D-PROF-39: inativa o profissional (todos os registros), com o motivo. */
  @Post('profissionais/:id/inativar')
  @HttpCode(200)
  @Permissao('cadastro.profissional.excluir')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async inativar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ profissional: number }> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    await this.gravar(
      req,
      'cadastro.inativarProfissional',
      esquemaSituacaoProfissional,
      { ...c, profissional: n },
      n,
    );
    return { profissional: n };
  }

  /** D-PROF-39: reativa o profissional (os registros que a inativação desligou), com o motivo. */
  @Post('profissionais/:id/reativar')
  @HttpCode(200)
  @Permissao('cadastro.profissional.excluir')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async reativar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ profissional: number }> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    await this.gravar(
      req,
      'cadastro.reativarProfissional',
      esquemaSituacaoProfissional,
      { ...c, profissional: n },
      n,
    );
    return { profissional: n };
  }

  /** D-PROF-39: exclui o profissional cadastrado por engano (só sem vínculo; senha de novo). */
  @Post('profissionais/:id/excluir')
  @HttpCode(200)
  @Permissao('cadastro.profissional.excluir')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async excluir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ profissional: number }> {
    const n = idDaRota(id);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    await this.gravar(
      req,
      'cadastro.excluirProfissional',
      esquemaExcluirProfissional,
      { ...c, profissional: n },
      n,
    );
    return { profissional: n };
  }

  /** D-PROF-39: exclui o registro incluído por engano (só sem atos; senha de novo). */
  @Post('profissionais/:id/registros/:registro/excluir')
  @HttpCode(200)
  @Permissao('cadastro.profissional.excluir')
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (memória: registrador da API)')
  async excluirRegistro(
    @Param('id') id: string,
    @Param('registro') registro: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroProfissionalGravado> {
    const n = idDaRota(id);
    const reg = idDaRota(registro);
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    await this.gravar(
      req,
      'cadastro.excluirRegistroProfissional',
      esquemaExcluirRegistroProfissional,
      { ...c, registro: reg },
      n,
      reg,
    );
    return { registro: reg };
  }

  private async gravarDoRegistro(
    req: RequisicaoAutorizada,
    id: string,
    corpo: unknown,
    op: OperacaoProfissionalTela,
    esquema: z.ZodType<{ registro: number }>,
  ): Promise<RegistroProfissionalGravado> {
    const n = idDaRota(id);
    const e = this.validar(esquema, corpo);
    await this.gravar(req, op, esquema, e, n, e.registro);
    return { registro: e.registro };
  }

  private validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
    const e = esquema.safeParse(corpo);
    if (!e.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(e.error.issues.map((i) => i.path.join('.')))],
      });
    return e.data;
  }

  /**
   * Valida o corpo, confere que o registro é do profissional da rota (IDOR: o registro de outro profissional dá 404),
   * grava pelo executor (na memória, as mesmas regras e a trilha pelo registrador da API) e devolve o resultado.
   */
  private async gravar<T>(
    req: RequisicaoAutorizada,
    op: OperacaoProfissionalTela,
    esquema: z.ZodType<T>,
    corpo: unknown,
    profissional: number | null,
    registro?: number,
  ): Promise<Record<string, number>> {
    const s = sessaoDe(req);
    // A senha das críticas (reautenticação, SBIS-07) vem no corpo e nunca chega à entrada da operação.
    let senha: string | undefined;
    if (corpo && typeof corpo === 'object' && 'senha' in corpo) {
      const { senha: x, ...resto } = corpo as Record<string, unknown>;
      senha = typeof x === 'string' ? x : undefined;
      corpo = resto;
    }
    const entrada = this.validar(esquema, corpo);
    let reautenticadoEm: number | undefined;
    if (OPERACOES_PROFISSIONAL_CRITICAS.has(op)) {
      if (!this.resolvedor)
        throw new ErroProblema(
          'reautenticacao-necessaria',
          401,
          'Confirme a senha',
          'Entre com o seu usuário.',
        );
      reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, senha);
    }
    try {
      if (profissional !== null) {
        const f = await this.porta.fichaProfissional(s.porta, profissional);
        if (!f || (registro !== undefined && !f.registros.some((r) => r.id === registro)))
          throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
      }
      const r = await this.porta.gravarProfissional(s.porta, op, entrada, {
        ...contextoOperacao(s, 'cadastro-profissional'),
        ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
      });
      const alvo = r.resultado['profissional'] ?? profissional ?? 0;
      if (this.porta.destino === 'memoria')
        await this.trilha.registrar({
          evento:
            op === 'cadastro.cadastrarProfissional'
              ? EVENTOS_AUDITAVEIS.cadastroProfissionalCadastrado.codigo
              : op === 'cadastro.excluirProfissional'
                ? EVENTOS_AUDITAVEIS.cadastroProfissionalExcluido.codigo
                : EVENTOS_AUDITAVEIS.cadastroProfissionalAlterado.codigo,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, `profissional-${alvo}`).slice(0, 64),
          recurso: 'cadastro.profissional',
          resultado: 'sucesso',
          tabelaAlvo: 'MEMORIA',
          idAlvo: String(alvo),
        });
      return r.resultado;
    } catch (x) {
      if (x instanceof ErroProblema) throw x;
      throw problemaDoCadastro(x);
    }
  }

  @Get('profissionais/:id/historico')
  @Permissao('cadastro.historico.ler')
  @Auditar('cadastro.historico.lido')
  async historico(
    @Param('id') id: string,
    @Query('pagina') p: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HistoricoProfissional> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const pg = pagina(p);
    const h = await this.porta.historicoProfissional(s.porta, n, pg, 100);
    if (h.nome === null) throw new ErroProblema('nao-encontrado', 404, 'Profissional não encontrado');
    const perm = permissoesDaFicha(s.pode);
    const permite = { documento: perm.verDocumento, sensivel: perm.verSensivel };
    req.sghAlvo = { tabelaAlvo: 'HTPROFIS', idAlvo: String(n) };
    return {
      id: n,
      nome: h.nome,
      versoes: h.versoes.map((v, i) => ({
        id: v.id,
        em: v.em ?? '',
        usuario: v.usuario,
        mudancas: mudancasEntreVersoes(
          (h.versoes[i + 1] ?? h.anterior)?.valores ?? null,
          v.valores,
          CAMPOS_HISTORICO_PROFISSIONAL,
          permite,
        ),
        // Telefone do funcionário com a mesma regra do paciente: sem verDocumento, mascarado.
        telefones: v.telefones.map((t) => ({
          tipo: `tipo ${t.tipo}`,
          numero: perm.verDocumento ? t.numero : (mascararTelefone(t.numero) ?? ''),
        })),
      })),
      pagina: pg,
      porPagina: 100,
      total: h.total,
    };
  }

  @Get('solicitantes')
  @Permissao('cadastro.solicitante.ler')
  async solicitantes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaSolicitantes> {
    const s = sessaoDe(req);
    const reg = registroDaConsulta(q);
    const termo = (q['termo'] ?? '').slice(0, 100).trim();
    try {
      let r: Awaited<ReturnType<PortaCadastro['listarSolicitantes']>>;
      // Conselho + UF + número (ficha §4; a busca mais usada na guia TISS, regra 12).
      if (reg) r = await this.porta.solicitantesPorRegistro(s.porta, reg);
      else if (termo === '') r = await this.porta.listarSolicitantes(s.porta);
      else {
        const palavras = palavrasDoTermo(termo);
        if (!termoIdentifica(palavras))
          throw new ErroProblema(
            'entrada-invalida',
            400,
            'Termo de busca inválido',
            'Digite ao menos uma palavra de duas letras.',
          );
        const ids = await this.porta.idsPorPalavra(
          s.porta,
          'solicitante',
          ['nome'],
          palavraMaisSeletiva(palavras) as string,
        );
        const lidos = await this.porta.listarSolicitantes(s.porta, [...ids.ids].slice(0, 500));
        r = {
          itens: lidos.itens.filter((x) => casaPalavras(palavras, palavrasDoCadastro(x.nome))),
          truncado: ids.ids.size > 500,
        };
      }
      const repetidas = await this.porta.chavesRepetidasSolicitante(s.porta);
      return {
        itens: r.itens.map((x) => ({
          ...x,
          // Regra 12: o mesmo conselho + UF + número de outro solicitante.
          duplicado: repetidas.has(`${x.conselho ?? ''}|${x.uf ?? ''}|${x.numero ?? 0}`),
          incompleto: incompleto(x),
        })),
        truncado: r.truncado,
      };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  /**
   * Revisão do M39 (onda 1, campo 7): inclui o médico solicitante externo. O conselho vem pela sigla (o cadastro de
   * conselhos resolve o ID); o executor confere a liberação, deduplica por conselho + UF + número e grava a trilha na
   * mesma transação (na memória, o registrador da API).
   */
  @Post('solicitantes')
  @HttpCode(201)
  @Permissao('cadastro.solicitante.criar')
  @AuditadoNoHandler(
    'executor: TBCABTRILHA e SGH_TRILHA na mesma transação da receita (memória: registrador da API)',
  )
  async incluirSolicitante(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SolicitanteIncluido> {
    const s = sessaoDe(req);
    const e = esquemaIncluirSolicitante.safeParse(corpo);
    if (!e.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(e.error.issues.map((i) => i.path.join('.')))],
      });
    try {
      const conselho = await this.porta.conselhoPorSigla(s.porta, e.data.conselho);
      if (conselho === null)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Conselho não encontrado',
          'Confira a sigla do conselho (CRM, CRO…).',
          { campos: ['conselho'] },
        );
      const r = await this.porta.cadastrarSolicitante(
        s.porta,
        { nome: e.data.nome, conselho, uf: e.data.uf, numero: e.data.numero },
        contextoOperacao(s, 'cadastro-solicitante'),
      );
      if (this.porta.destino === 'memoria')
        await this.trilha.registrar({
          evento: EVENTOS_AUDITAVEIS.sadtSolicitanteCadastrado.codigo,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, `solicitante-${r.resultado.solicitante}`).slice(0, 64),
          recurso: 'cadastro.solicitante',
          resultado: 'sucesso',
          tabelaAlvo: 'MEMORIA',
          idAlvo: String(r.resultado.solicitante),
        });
      return r.resultado;
    } catch (x) {
      if (x instanceof ErroProblema) throw x;
      throw problemaDoCadastro(x);
    }
  }

  @Get('pessoas')
  @Permissao('cadastro.pessoa.ler')
  @Auditar('cadastro.pessoa.buscada')
  async pessoas(
    @Query('documento') documento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaPessoas> {
    const s = sessaoDe(req);
    const d = (documento ?? '').replace(/\D+/g, '');
    if (d.length !== 11 && d.length !== 14)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Documento inválido',
        'Informe o CPF (11 dígitos) ou o CNPJ (14).',
        {
          campos: ['documento'],
        },
      );
    const r = await this.porta.buscarPessoas(s.porta, d);
    const verDocumento = s.pode('cadastro.paciente.verDocumento');
    req.sghAlvo = { tabelaAlvo: 'TBPESSOA', chaveNaturalAlvo: `busca:documento;n:${r.length}` };
    return {
      itens: r.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        documento:
          p.documento === null
            ? null
            : p.documento.length === 11
              ? verDocumento
                ? formatarCpf(p.documento)
                : mascararCpf(p.documento)
              : p.documento,
        documentoMascarado: !verDocumento && (p.documento?.length ?? 0) === 11,
        profissionais: p.profissionais,
        pacientes: p.pacientes,
      })),
      truncado: false,
    };
  }

  @Get('especialidades/:cod/procedimentos')
  @Permissao('cadastro.especialidade.ler')
  async procedimentos(
    @Param('cod') cod: string,
    @Query('pagina') p: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProcedimentosEspecialidade> {
    const s = sessaoDe(req);
    if (!/^\d{1,2}$/.test(cod)) throw new ErroProblema('nao-encontrado', 404, 'Especialidade não encontrada');
    const pg = pagina(p, 10_000);
    const r = await this.porta.procedimentosDaEspecialidade(s.porta, Number(cod), pg, POR_PAGINA);
    return { especialidade: Number(cod), itens: r.itens, pagina: pg, porPagina: POR_PAGINA, total: r.total };
  }

  @Get('conselhos/siglas')
  @Permissao('cadastro.conselho.ler')
  async siglas(@Req() req: RequisicaoAutorizada): Promise<SiglasConselho> {
    const s = sessaoDe(req);
    return { itens: await this.porta.siglasDosConselhos(s.porta) };
  }
}
