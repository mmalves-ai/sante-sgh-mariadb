// A porta da gestão da qualidade em memória (M48, etapa 5): dev/ci e os testes, com dados SINTÉTICOS (nenhum paciente
// real): três respostas da pesquisa do portal e dois incidentes no mês anterior ao do relógio, um paciente do cadastro e
// os feriados nacionais fixos. As gravações seguem as travas do banco (versão, chaves únicas, a revisão vigente
// substituída, a geração que substitui a anterior, a transmissão só com o mesmo resumo).
import {
  aprovacoesPendentesMemoria,
  gravacoesAprovacaoMemoria,
  submissaoMemoria,
  type SubmissaoMemoria,
} from './aprovacao-documento-memoria.js';
import type {
  ControleRiscoGravado,
  ControleRiscoNovo,
  AnaliseIndicadorRegistrada,
  AuditoriaRegistrada,
  ComissaoRegistrada,
  DocumentoQualidadeRegistrado,
  EnvioRegulatorioRegistrado,
  ManifestacaoRegistrada,
  NaoConformidadeRegistrada,
  PesquisaSatisfacaoRespondida,
  ProtocoloDoPaciente,
  ReuniaoComissaoRegistrada,
  RiscoRegistrado,
  VersaoProtocoloGerenciado,
  AltaParaRevisao,
  ChecklistRevisaoRegistrado,
  PendenciaRevisaoRegistrada,
  ProntuarioRevisaoRegistrado,
  SorteioRevisaoRegistrado,
} from './tipos.js';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import {
  type DependentesRegistro,
  PROTOCOLO_OUVIDORIA,
  recusaVersaoGestao,
  type TabelaCorrigivel,
  type VersaoRegistro,
} from './tipos.js';
import { recusa } from '@sgh/nucleo';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import { conferirRetirada } from './porta-propria-documentos.js';
import type {
  ContextoGestao,
  GravadorGestao,
  IncidenteParaNotivisaLido,
  PortaGestao,
} from './porta-gestao.js';

/** IDs sintéticos (fora de qualquer faixa real do banco). */
export const GESTAO_SINTETICA = {
  paciente: 9_048_501,
  pesquisaDetrator: 9_485_003,
  /** As notificações de incidente sintéticas do NSP (a origem da não conformidade). */
  notificacoes: [9_480_001, 9_480_002],
} as const;

/** A busca da ouvidoria como no repositório: o protocolo igual, ou o trecho no protocolo, na área ou no relato. */
function buscaManifestacao(m: ManifestacaoRegistrada, busca: string): boolean {
  const b = busca.trim().toUpperCase();
  if (PROTOCOLO_OUVIDORIA.test(b)) return m.protocolo === b;
  return [m.protocolo, m.area, m.relato].some((x) => x.toUpperCase().includes(b));
}

interface Estado {
  /** Fluxo de aprovação por etapas dos documentos (C2-060). */
  submissoes?: SubmissaoMemoria[];
  documentos: (DocumentoQualidadeRegistrado & { conteudo: string })[];
  ciencias: { id: number; documento: number; usuario: string; cienteEm: string }[];
  analises: AnaliseIndicadorRegistrada[];
  auditorias: AuditoriaRegistrada[];
  comissoes: ComissaoRegistrada[];
  reunioes: ReuniaoComissaoRegistrada[];
  riscos: RiscoRegistrado[];
  ncs: NaoConformidadeRegistrada[];
  manifestacoes: ManifestacaoRegistrada[];
  envios: EnvioRegulatorioRegistrado[];
  /** W0-04: as versões anteriores (tabela|id → versões). */
  versoes: Map<string, VersaoRegistro[]>;
  /** W0-04 (M5): a comissão de revisão de prontuários. */
  checklistsRev: ChecklistRevisaoRegistrado[];
  sorteiosRev: Omit<SorteioRevisaoRegistrado, 'revisados' | 'checklistRevisao'>[];
  prontuariosRev: ProntuarioRevisaoRegistrado[];
  pendenciasRev: PendenciaRevisaoRegistrada[];
  seq: number;
}

const pagina = <T>(xs: readonly T[], f: { pagina: number; porPagina: number }) => ({
  itens: xs.slice((f.pagina - 1) * f.porPagina, f.pagina * f.porPagina),
  total: xs.length,
});
const segundos = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));

/** Os controles do risco após a gravação: a data da avaliação muda só quando a eficácia muda (como no banco). */
function controlesGravados(
  lista: readonly ControleRiscoNovo[],
  antes: readonly ControleRiscoGravado[],
  agora: string,
): ControleRiscoGravado[] {
  return lista.map((c) => {
    const ja = antes.find((a) => a.nome.toUpperCase() === c.nome.trim().toUpperCase());
    const avaliadoEm =
      ja && ja.eficacia === c.eficacia
        ? ja.avaliadoEm
        : c.eficacia === 'naoAvaliado'
          ? null
          : agora.slice(0, 10);
    return { nome: c.nome.trim(), tipo: c.tipo, eficacia: c.eficacia, avaliadoEm };
  });
}

export class PortaGestaoMemoria implements PortaGestao {
  readonly destino = 'memoria' as const;
  private estado: Estado = {
    documentos: [],
    ciencias: [],
    analises: [],
    auditorias: [],
    comissoes: [],
    reunioes: [],
    riscos: [],
    ncs: [],
    manifestacoes: [],
    envios: [],
    versoes: new Map(),
    checklistsRev: [],
    sorteiosRev: [],
    prontuariosRev: [],
    pendenciasRev: [],
    seq: 0,
  };
  /**
   * W0-04 (M5): as altas sintéticas por competência (AAAA-MM → altas) e o login de cada médico assistente; os testes
   * e o E2E definem (a sessão sintética de dev tem as do mês anterior).
   */
  altasSint = new Map<string, AltaParaRevisao[]>();
  loginsSint = new Map<number, string>();
  /** Revisão do W0-04: simula a leitura das altas cortada pelo teto (o sorteio recusa). */
  cortadaSint = false;
  private readonly pesquisasSint: PesquisaSatisfacaoRespondida[];
  private readonly incidentesSint: IncidenteParaNotivisaLido[];
  /**
   * W0-04 (M2): notificações por tipo além dos incidentes sintéticos do Notivisa (os testes definem; cada uma com a
   * data do incidente). W0-04 (M3): os protocolos gerenciados (os testes definem as versões e as inclusões).
   */
  notificacoesSint: { ocorridoEm: string; tipo: string; classificacao: string }[] = [];
  protocolosSint: { versoes: VersaoProtocoloGerenciado[]; protocolos: ProtocoloDoPaciente[] } = {
    versoes: [],
    protocolos: [],
  };

  constructor(private readonly opcoes: { agora?: () => Date } = {}) {
    const agora = this.agoraLocal();
    const ano = Number(agora.slice(0, 4));
    const mes = Number(agora.slice(5, 7));
    const [a, m] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
    const dia = (d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const pesq = (
      id: number,
      d: number,
      nota: number,
      comentario: string | null,
    ): PesquisaSatisfacaoRespondida => ({
      id,
      paciente: GESTAO_SINTETICA.paciente,
      tipo: 'consulta',
      agenda: 'AGENDA SINTETICA',
      dataAtendimento: dia(d),
      nota,
      comentario,
      respondidaEm: `${dia(d)}T18:00:00`,
      manifestacao: null,
    });
    this.pesquisasSint = [
      pesq(9_485_001, 3, 10, null),
      pesq(9_485_002, 5, 9, 'Atendimento rápido (sintético).'),
      pesq(GESTAO_SINTETICA.pesquisaDetrator, 8, 4, 'Esperei muito na recepção (sintético).'),
    ];
    // W0-04 (M5): 24 altas sintéticas da competência anterior em três clínicas; o médico 501 é o SINT.MEDICO.
    const clinicas = ['Clínica médica', 'Cirurgia geral', 'Pediatria'];
    this.altasSint.set(
      `${String(a)}-${String(m).padStart(2, '0')}`,
      Array.from({ length: 24 }, (_, i) => ({
        reg: 9_480_100 + i,
        paciente: null,
        alta: dia((i % 27) + 1),
        clinica: clinicas[i % 3]!,
        medicoRegistro: i % 2 ? 502 : 501,
        medicoNome: i % 2 ? 'MEDICA SINTETICA' : 'MEDICO SINTETICO',
      })),
    );
    this.loginsSint.set(501, 'SINT.MEDICO');
    this.incidentesSint = [
      {
        numero: 'NSP-SINT-0001',
        ocorridoEm: `${dia(4)}T10:00:00`,
        tipo: 'queda',
        classificacao: 'eventoAdverso',
        dano: 'leve',
        neverEvent: false,
        transcritaEm: null,
        numeroNotivisa: null,
      },
      {
        numero: 'NSP-SINT-0002',
        ocorridoEm: `${dia(12)}T22:30:00`,
        tipo: 'medicacao',
        classificacao: 'eventoAdverso',
        dano: 'moderado',
        neverEvent: false,
        transcritaEm: `${dia(14)}T09:00:00`,
        numeroNotivisa: '2026000001',
      },
    ];
  }

  private agoraLocal(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora.slice(0, 19);
  }

  podeGravar(): Promise<LiberacaoGravacao> {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }
  executar(_c: ContextoGestao, op: string): Promise<never> {
    return Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`));
  }
  relogio(): Promise<string> {
    return Promise.resolve(this.agoraLocal());
  }
  feriados(): Promise<{ data: string }[]> {
    // Os feriados nacionais fixos (o ano 9999 vale todo ano, como o cadastro guarda).
    const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
    return Promise.resolve(fixos.map((d) => ({ data: `9999-${d}` })));
  }
  nomesPacientes(_c: ContextoGestao, ids: readonly number[]): Promise<Map<number, string>> {
    return Promise.resolve(
      new Map(
        ids.map((id) => [
          id,
          id === GESTAO_SINTETICA.paciente ? 'PACIENTE SINTETICO OUVIDORIA' : `PACIENTE ${id}`,
        ]),
      ),
    );
  }

  /** C2-060: os setores sintéticos do estabelecimento (a área do documento é escolhida na lista, nunca digitada). */
  setoresDaArea(): ReturnType<PortaGestao['setoresDaArea']> {
    return Promise.resolve([
      { id: 9101, codigo: 'UTI', nome: 'UTI adulto (sintético)' },
      { id: 9102, codigo: 'CC', nome: 'Centro cirúrgico (sintético)' },
      { id: 9103, codigo: null, nome: 'Farmácia (sintético)' },
    ]);
  }

  documentos(_c: ContextoGestao, f: Parameters<PortaGestao['documentos']>[1]) {
    const b = f.busca?.toUpperCase();
    const xs = this.estado.documentos
      .filter((d) => (!f.situacao || d.situacao === f.situacao) && (!f.tipo || d.tipo === f.tipo))
      .filter((d) => !b || d.codigo.includes(b) || d.titulo.toUpperCase().includes(b))
      .sort((x, y) => x.codigo.localeCompare(y.codigo) || y.revisao - x.revisao)
      .map((d) => ({ ...d, conteudo: null }));
    return Promise.resolve(pagina(xs, f));
  }
  documento(_c: ContextoGestao, id: number) {
    const d = this.estado.documentos.find((x) => x.id === id);
    return Promise.resolve(d ? { ...d } : null);
  }
  submissaoDocumento(_c: ContextoGestao, id: number) {
    return Promise.resolve(submissaoMemoria(this.estado, id));
  }
  aprovacoesPendentes(_c: ContextoGestao, login: string) {
    return Promise.resolve(aprovacoesPendentesMemoria(this.estado, login));
  }
  documentosDoCodigo(_c: ContextoGestao, codigo: string) {
    return Promise.resolve(
      this.estado.documentos.filter((d) => d.codigo === codigo).map((d) => ({ ...d, conteudo: null })),
    );
  }
  ciencias(_c: ContextoGestao, docs: readonly number[], usuario: string) {
    const m = new Map<number, { total: number; sessao: boolean }>();
    for (const id of new Set(docs)) {
      const cs = this.estado.ciencias.filter((c) => c.documento === id);
      if (cs.length)
        m.set(id, { total: cs.length, sessao: cs.some((c) => c.usuario === usuario.toUpperCase()) });
    }
    return Promise.resolve(m);
  }
  cientes(_c: ContextoGestao, documento: number) {
    return Promise.resolve(
      this.estado.ciencias
        .filter((c) => c.documento === documento)
        .map((c) => ({ usuario: c.usuario, cienteEm: c.cienteEm })),
    );
  }
  /** A porta de memória não tem distribuição: ninguém fica pendente (documento aberto). */
  pendentesCiencia(): Promise<{ usuario: string; nome: string }[]> {
    return Promise.resolve([]);
  }
  analises(_c: ContextoGestao, competencia: string) {
    return Promise.resolve(
      this.estado.analises.filter((a) => a.competencia === competencia).map((a) => ({ ...a })),
    );
  }
  historicoAnalises(_c: ContextoGestao, indicador: string) {
    return Promise.resolve(
      this.estado.analises
        .filter((a) => a.indicador === indicador)
        .sort((x, y) => y.competencia.localeCompare(x.competencia))
        .slice(0, 24),
    );
  }
  auditorias(_c: ContextoGestao, f: { pagina: number; porPagina: number }) {
    return Promise.resolve(
      pagina(
        [...this.estado.auditorias].sort((x, y) => y.realizadaEm.localeCompare(x.realizadaEm) || y.id - x.id),
        f,
      ),
    );
  }
  auditoria(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.auditorias.find((a) => a.id === id) ?? null);
  }
  naoConformidadesPorOrigem(_c: ContextoGestao, origem: string, ids: readonly number[]) {
    const m = new Map<number, number>();
    for (const n of this.estado.ncs)
      if (n.origem === origem && n.idOrigem !== null && ids.includes(n.idOrigem) && !n.canceladaEm)
        m.set(n.idOrigem, (m.get(n.idOrigem) ?? 0) + 1);
    return Promise.resolve(m);
  }
  private comUltimas(c: ComissaoRegistrada): ComissaoRegistrada {
    const rs = this.estado.reunioes.filter((r) => r.comissao === c.id);
    const max = (xs: readonly ReuniaoComissaoRegistrada[]) =>
      xs.length
        ? xs
            .map((r) => r.realizadaEm)
            .sort()
            .at(-1)!
        : null;
    return { ...c, ultimaOrdinaria: max(rs.filter((r) => r.tipo === 'ordinaria')), ultimaReuniao: max(rs) };
  }
  comissoes() {
    return Promise.resolve(
      [...this.estado.comissoes]
        .sort((x, y) => Number(y.ativa) - Number(x.ativa) || x.nome.localeCompare(y.nome))
        .map((c) => this.comUltimas(c)),
    );
  }
  comissao(_c: ContextoGestao, id: number) {
    const c = this.estado.comissoes.find((x) => x.id === id);
    return Promise.resolve(c ? this.comUltimas(c) : null);
  }
  reunioes(_c: ContextoGestao, comissao: number) {
    return Promise.resolve(
      this.estado.reunioes
        .filter((r) => r.comissao === comissao)
        .sort((x, y) => y.realizadaEm.localeCompare(x.realizadaEm)),
    );
  }
  riscos(_c: ContextoGestao, f: { pagina: number; porPagina: number; situacao?: string | undefined }) {
    const xs = this.estado.riscos
      .filter((r) => !f.situacao || r.situacao === f.situacao)
      .sort((x, y) => y.pontuacao - x.pontuacao || x.id - y.id);
    return Promise.resolve(pagina(xs, f));
  }
  risco(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.riscos.find((r) => r.id === id) ?? null);
  }
  naoConformidades(_c: ContextoGestao, f: Parameters<PortaGestao['naoConformidades']>[1]) {
    const xs = this.estado.ncs
      .filter(
        (n) =>
          (!f.situacao || n.situacao === f.situacao) &&
          (!f.origem || n.origem === f.origem) &&
          (f.idOrigem === undefined || n.idOrigem === f.idOrigem),
      )
      .sort(
        (x, y) =>
          Number(x.situacao === 'encerrada') - Number(y.situacao === 'encerrada') ||
          (x.prazo ?? '9999').localeCompare(y.prazo ?? '9999') ||
          y.id - x.id,
      );
    return Promise.resolve(pagina(xs, f));
  }
  naoConformidade(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.ncs.find((n) => n.id === id) ?? null);
  }
  manifestacoes(_c: ContextoGestao, f: Parameters<PortaGestao['manifestacoes']>[1]) {
    const xs = this.estado.manifestacoes
      .filter(
        (m) =>
          (!f.situacao || m.situacao === f.situacao) &&
          (!f.tipo || m.tipo === f.tipo) &&
          (!f.busca || buscaManifestacao(m, f.busca)) &&
          (!f.recebidaDe || m.recebidaEm.slice(0, 10) >= f.recebidaDe) &&
          (!f.recebidaAntes || m.recebidaEm.slice(0, 10) < f.recebidaAntes),
      )
      .sort(
        (x, y) =>
          Number(x.situacao === 'respondida') - Number(y.situacao === 'respondida') ||
          x.prazoEm.localeCompare(y.prazoEm) ||
          y.id - x.id,
      );
    return Promise.resolve(pagina(xs, f));
  }
  manifestacao(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.manifestacoes.find((m) => m.id === id) ?? null);
  }
  pesquisas(_c: ContextoGestao, de: string, ate: string) {
    const itens = this.pesquisasSint
      .filter((p) => p.dataAtendimento >= de && p.dataAtendimento <= ate)
      .map((p) => ({
        ...p,
        manifestacao: this.estado.manifestacoes.find((m) => m.pesquisa === p.id)?.id ?? null,
      }));
    return Promise.resolve({ itens, cortada: false });
  }
  pesquisa(_c: ContextoGestao, id: number) {
    const p = this.pesquisasSint.find((x) => x.id === id);
    return Promise.resolve(
      p
        ? {
            id: p.id,
            paciente: p.paciente,
            nota: p.nota,
            comentario: p.comentario,
            respondidaEm: p.respondidaEm,
          }
        : null,
    );
  }
  contagem(_c: ContextoGestao, agora: string, usuario: string) {
    const hoje = agora.slice(0, 10);
    const s = this.estado;
    const vig = s.documentos.filter((d) => d.situacao === 'vigente');
    const ncs = s.ncs.filter((n) => n.situacao !== 'encerrada' && !n.canceladaEm);
    const ms = s.manifestacoes.filter((m) => m.situacao !== 'respondida' && !m.canceladaEm);
    return Promise.resolve({
      documentosVigentes: vig.length,
      documentosRevisaoVencida: vig.filter((d) => d.vigenciaAte < hoje).length,
      cienciasPendentesSessao: vig.filter(
        (d) =>
          d.exigeCiencia &&
          !s.ciencias.some((c) => c.documento === d.id && c.usuario === usuario.toUpperCase()),
      ).length,
      riscosCriticos: s.riscos.filter(
        (r) => ['identificado', 'emTratamento'].includes(r.situacao) && r.pontuacao >= 64,
      ).length,
      naoConformidadesAbertas: ncs.length,
      naoConformidadesVencidas: ncs.filter((n) => n.prazo !== null && n.prazo < hoje).length,
      manifestacoesAbertas: ms.length,
      manifestacoesVencidas: ms.filter((m) => m.prazoEm < segundos(agora)).length,
    });
  }
  envios(_c: ContextoGestao, desde: string) {
    return Promise.resolve(
      this.estado.envios
        .filter((e) => e.competencia >= desde)
        .sort(
          (x, y) =>
            y.competencia.localeCompare(x.competencia) ||
            x.tipo.localeCompare(y.tipo) ||
            y.revisao - x.revisao,
        ),
    );
  }
  envio(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.envios.find((e) => e.id === id) ?? null);
  }
  reuniao(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.reunioes.find((r) => r.id === id) ?? null);
  }
  versoes(_c: ContextoGestao, tabela: TabelaCorrigivel, id: number) {
    return Promise.resolve([...(this.estado.versoes.get(`${tabela}|${id}`) ?? [])].reverse());
  }
  /** O mapa de dependências (MAPA_DEPENDENCIAS_QUALIDADE) sobre o estado em memória. */
  dependentes(_c: ContextoGestao, tabela: string, id: number): Promise<DependentesRegistro[]> {
    const ativas = this.estado.ncs.filter((n) => !n.canceladaEm);
    const grupo = (g: string, dependente: string, ids: number[]): DependentesRegistro[] =>
      ids.length ? [{ grupo: g, dependente, quantidade: ids.length, ids }] : [];
    const porOrigem = (origem: string, g: string) =>
      grupo(
        g,
        'nao_conformidade_qualidade',
        ativas.filter((n) => n.origem === origem && n.idOrigem === id).map((n) => n.id),
      );
    if (tabela === 'auditoria_interna')
      return Promise.resolve(porOrigem('auditoria', 'Não conformidades da auditoria'));
    if (tabela === 'manifestacao_ouvidoria')
      return Promise.resolve(porOrigem('ouvidoria', 'Não conformidades da manifestação'));
    if (tabela === 'risco_institucional')
      return Promise.resolve(porOrigem('risco', 'Não conformidades do risco'));
    if (tabela === 'nao_conformidade_qualidade')
      return Promise.resolve(
        grupo(
          'Não conformidades marcadas como duplicadas desta',
          'nao_conformidade_qualidade',
          this.estado.ncs.filter((n) => n.duplicadaDe === id).map((n) => n.id),
        ),
      );
    // Revisão do W0-04: a comissão (inativação ou troca do tipo) com o checklist vigente e os sorteios em andamento.
    if (tabela === 'comissao_hospitalar')
      return Promise.resolve([
        ...grupo(
          'Checklist vigente da revisão de prontuários (inative-o antes)',
          'modelo_checklist_qualidade_versao',
          this.estado.checklistsRev
            .filter((c) => c.comissao === id && c.situacao === 'vigente')
            .map((c) => c.id),
        ),
        ...grupo(
          'Sorteios de prontuários em andamento (com prontuário sem o aval)',
          'sorteio_revisao_prontuario',
          this.estado.sorteiosRev
            .filter(
              (so) =>
                so.comissao === id &&
                !so.canceladoEm &&
                this.estado.prontuariosRev.some((p) => p.sorteio === so.id && !p.avalEm),
            )
            .map((so) => so.id),
        ),
      ]);
    if (tabela === 'sorteio_revisao_prontuario')
      return Promise.resolve(
        grupo(
          'Prontuários já revisados do sorteio',
          'revisao_prontuario',
          this.estado.prontuariosRev
            .filter((p) => p.sorteio === id && p.situacao !== 'aRevisar')
            .map((p) => p.id),
        ),
      );
    return Promise.resolve([]);
  }
  notificacaoExiste(_c: ContextoGestao, id: number) {
    return Promise.resolve((GESTAO_SINTETICA.notificacoes as readonly number[]).includes(id));
  }
  // ── W0-04 (M5): revisão de prontuários ──
  checklistsRevisao(_c: ContextoGestao, comissao: number) {
    return Promise.resolve(
      this.estado.checklistsRev.filter((x) => x.comissao === comissao).sort((a, b) => b.revisao - a.revisao),
    );
  }
  checklistRevisao(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.checklistsRev.find((x) => x.id === id) ?? null);
  }
  altasParaRevisao(_c: ContextoGestao, de: string, ate: string) {
    const itens = (this.altasSint.get(de.slice(0, 7)) ?? []).filter((a) => a.alta >= de && a.alta < ate);
    return Promise.resolve({ itens, cortada: this.cortadaSint });
  }
  loginsDosMedicos(_c: ContextoGestao, registros: readonly number[]) {
    return Promise.resolve(new Map(registros.map((r) => [r, this.loginsSint.get(r) ?? ''])));
  }
  private sorteioLido(
    x: Omit<SorteioRevisaoRegistrado, 'revisados' | 'checklistRevisao'>,
  ): SorteioRevisaoRegistrado {
    return {
      ...x,
      checklistRevisao: this.estado.checklistsRev.find((c) => c.id === x.checklist)?.revisao ?? 0,
      revisados: this.estado.prontuariosRev.filter((p) => p.sorteio === x.id && p.situacao !== 'aRevisar')
        .length,
    };
  }
  sorteiosRevisao(_c: ContextoGestao, comissao: number) {
    return Promise.resolve(
      this.estado.sorteiosRev
        .filter((x) => x.comissao === comissao)
        .sort((a, b) => b.competencia.localeCompare(a.competencia) || b.id - a.id)
        .map((x) => this.sorteioLido(x)),
    );
  }
  sorteioRevisao(_c: ContextoGestao, id: number) {
    const x = this.estado.sorteiosRev.find((y) => y.id === id);
    return Promise.resolve(x ? this.sorteioLido(x) : null);
  }
  prontuariosDoSorteio(_c: ContextoGestao, sorteio: number) {
    return Promise.resolve(
      this.estado.prontuariosRev.filter((p) => p.sorteio === sorteio).sort((a, b) => a.ordem - b.ordem),
    );
  }
  prontuarioRevisao(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.prontuariosRev.find((p) => p.id === id) ?? null);
  }
  pendenciasDosProntuarios(_c: ContextoGestao, ids: readonly number[]) {
    return Promise.resolve(this.estado.pendenciasRev.filter((p) => ids.includes(p.prontuario)));
  }
  pendenciaRevisao(_c: ContextoGestao, id: number) {
    return Promise.resolve(this.estado.pendenciasRev.find((p) => p.id === id) ?? null);
  }
  pendenciasDoLogin(_c: ContextoGestao, login: string) {
    return Promise.resolve(
      this.estado.pendenciasRev
        .filter((p) => p.profissionalLogin === login.toUpperCase())
        .sort(
          (a, b) =>
            Number(a.situacao !== 'aberta') - Number(b.situacao !== 'aberta') ||
            a.prazo.localeCompare(b.prazo) ||
            a.id - b.id,
        ),
    );
  }
  private ativos(): Set<number> {
    return new Set(this.estado.sorteiosRev.filter((x) => !x.canceladoEm).map((x) => x.id));
  }
  revisoesDaCompetencia(_c: ContextoGestao, comissao: number, competencia: string) {
    const ok = new Set(
      this.estado.sorteiosRev
        .filter((x) => !x.canceladoEm && x.comissao === comissao && x.competencia === competencia)
        .map((x) => x.id),
    );
    return Promise.resolve(this.estado.prontuariosRev.filter((p) => ok.has(p.sorteio)));
  }
  revisoesDaInternacao(_c: ContextoGestao, reg: number) {
    const ok = this.ativos();
    return Promise.resolve(
      this.estado.prontuariosRev
        .filter((p) => p.reg === reg && ok.has(p.sorteio))
        .sort((a, b) => b.id - a.id),
    );
  }

  notificacoesPorTipo(_c: ContextoGestao, de: string, ate: string) {
    const todas = [...this.incidentesSint, ...this.notificacoesSint].filter(
      (i) => i.ocorridoEm >= de && i.ocorridoEm < ate,
    );
    const m = new Map<string, { tipo: string; classificacao: string; total: number }>();
    for (const i of todas) {
      const k = `${i.tipo}|${i.classificacao}`;
      const x = m.get(k) ?? { tipo: i.tipo, classificacao: i.classificacao, total: 0 };
      m.set(k, { ...x, total: x.total + 1 });
    }
    return Promise.resolve([...m.values()]);
  }
  protocolosGerenciados(_c: ContextoGestao, inicio: string, fim: string) {
    return Promise.resolve({
      versoes: this.protocolosSint.versoes,
      protocolos: this.protocolosSint.protocolos.filter((p) => p.incluidoEm >= inicio && p.incluidoEm < fim),
    });
  }
  incidentesNotivisa(_c: ContextoGestao, de: string, ate: string) {
    return Promise.resolve({
      itens: this.incidentesSint.filter((i) => i.ocorridoEm >= de && i.ocorridoEm < ate),
      cortada: false,
    });
  }

  /**
   * W0-10 (M1): a ouvidoria interna em memória recebe as manifestações do portal do paciente em memória (canal
   * "portal", identificada com o paciente da sessão), como a manifestacao_ouvidoria na cópia: a manifestação aparece na
   * tela da ouvidoria e a resposta dada nela volta ao portal (dev/ci e o E2E). Revisão do W0-10: cada manifestação
   * guarda o estabelecimento da sessão do portal e o portal só lê as do próprio hospital (a manifestacao_ouvidoria tem a
   * coluna HOSPITAL): o paciente 1001 do hospital B não vê a do paciente 1001 do hospital A.
   */
  ouvidoriaDoPortal() {
    const hospitalDe = new Map<number, string>();
    return {
      registrar: async (
        m: {
          readonly protocoloDe: (numero: number) => string;
          readonly tipo: string;
          readonly paciente: number;
          readonly area: string;
          readonly relato: string;
          readonly recebidaEm: string;
          readonly prazoEm: string;
          readonly usuario: string;
        },
        hospital: string,
      ) => {
        const r = await this.gravarSgh(null as unknown as ContextoGestao, null, (g) =>
          g.registrarManifestacao({
            protocoloDe: m.protocoloDe,
            canal: 'portal',
            tipo: m.tipo,
            identificada: true,
            paciente: m.paciente,
            manifestante: null,
            contato: null,
            area: m.area,
            relato: m.relato,
            recebidaEm: m.recebidaEm,
            prazoEm: m.prazoEm,
            pesquisa: null,
            agora: m.recebidaEm,
            usuario: m.usuario,
          }),
        );
        hospitalDe.set(r.id, hospital);
        return r;
      },
      doPaciente: (paciente: number, hospital: string): Promise<ManifestacaoRegistrada[]> =>
        Promise.resolve(
          this.estado.manifestacoes
            .filter(
              (m) => m.canal === 'portal' && m.paciente === paciente && hospitalDe.get(m.id) === hospital,
            )
            .sort((x, y) => y.id - x.id)
            .map((m) => ({ ...m })),
        ),
    };
  }

  async gravarSgh<T>(
    _c: ContextoGestao,
    _trilha: unknown,
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    const antes = structuredClone(this.estado);
    const s = this.estado;
    const id = () => ++s.seq + 9_485_000;
    const versao = <X extends { id: number; versao: number }>(
      xs: X[],
      i: number,
      v: number | null,
      o: string,
    ) => {
      const x = xs.find((y) => y.id === i);
      if (!x || x.versao !== v) throw recusaVersaoGestao(o);
      return x;
    };
    const troca = <X extends { id: number }>(xs: X[], novo: X) =>
      xs.map((y) => (y.id === novo.id ? novo : y));
    const versionar = (
      tabela: TabelaCorrigivel,
      x: { id: number; versao?: number },
      acao: VersaoRegistro['acao'],
      motivo: string,
      usuario: string,
      agora: string,
    ) => {
      const k = `${tabela}|${x.id}`;
      const lista = s.versoes.get(k) ?? [];
      lista.push({
        versao: x.versao ?? 1,
        acao,
        motivo,
        alteradoPor: usuario,
        alteradoEm: segundos(agora),
        dados: structuredClone(x) as unknown as Record<string, unknown>,
      });
      s.versoes.set(k, lista);
    };
    /** A versão conferida e o estado em que a mudança cabe (a mesma trava do UPDATE no banco). */
    const conferida = <X extends { id: number; versao?: number }>(
      xs: X[],
      i: number,
      v: number,
      cabe: (x: X) => boolean,
      o: string,
    ) => {
      const x = xs.find((y) => y.id === i);
      if (!x || (x.versao ?? 1) !== v || !cabe(x)) throw recusaVersaoGestao(o);
      return x;
    };
    const g: GravadorGestao = {
      // ── W0-04 (M5): revisão de prontuários ──
      publicarChecklistRevisao: async (p) => {
        if (p.vigente) {
          const v = conferida(
            s.checklistsRev,
            p.vigente.id,
            p.vigente.versao,
            (y) => y.situacao === 'vigente',
            'O checklist',
          );
          versionar(
            'modelo_checklist_qualidade_versao',
            v,
            'correcao',
            p.motivo ?? 'Substituída pela revisão seguinte',
            p.usuario,
            p.agora,
          );
          s.checklistsRev = troca(s.checklistsRev, { ...v, situacao: 'substituida', versao: v.versao + 1 });
        }
        const revisao =
          Math.max(0, ...s.checklistsRev.filter((x) => x.comissao === p.comissao).map((x) => x.revisao)) + 1;
        const novo = id();
        s.checklistsRev.push({
          id: novo,
          comissao: p.comissao,
          revisao,
          itens: p.itens,
          situacao: 'vigente',
          motivo: p.motivo,
          publicadoPor: p.usuario,
          publicadoEm: segundos(p.agora),
          inativadoPor: null,
          inativadoEm: null,
          motivoInativacao: null,
          versao: 1,
        });
        return { id: novo, revisao };
      },
      inativarChecklistRevisao: async (m) => {
        const x = conferida(s.checklistsRev, m.id, m.versao, (y) => y.situacao === 'vigente', 'O checklist');
        versionar('modelo_checklist_qualidade_versao', x, 'cancelamento', m.motivo, m.usuario, m.agora);
        s.checklistsRev = troca(s.checklistsRev, {
          ...x,
          situacao: 'inativa',
          motivoInativacao: m.motivo,
          inativadoPor: m.usuario,
          inativadoEm: segundos(m.agora),
          versao: m.versao + 1,
        });
        return { versao: m.versao + 1 };
      },
      sortearRevisao: async (x) => {
        // Divergência intencional: sem a recusa 'competencia-ja-sorteada' da porta própria (contrato de efeito em
        // porta-propria-comissao-sorteio.int.spec.ts).
        const novo = id();
        s.sorteiosRev.push({
          id: novo,
          comissao: x.comissao,
          checklist: x.checklist,
          competencia: x.competencia,
          semente: x.semente,
          quantidade: x.amostra.length,
          universo: x.universo,
          resumoUniverso: x.resumoUniverso,
          sorteadoPor: x.usuario,
          sorteadoEm: segundos(x.agora),
          canceladoEm: null,
          canceladoPor: null,
          motivoCancelamento: null,
          versao: 1,
        });
        x.amostra.forEach((a, i) =>
          s.prontuariosRev.push({
            id: id(),
            sorteio: novo,
            ordem: i + 1,
            reg: a.reg,
            paciente: a.paciente,
            alta: a.alta,
            clinica: a.clinica,
            medicoRegistro: a.medicoRegistro,
            medicoNome: a.medicoNome,
            situacao: 'aRevisar',
            respostas: null,
            observacao: null,
            revisadoPor: null,
            revisadoEm: null,
            avalPor: null,
            avalEm: null,
            versao: 1,
          }),
        );
        return { id: novo };
      },
      cancelarSorteioRevisao: async (m) => {
        if (s.prontuariosRev.some((p) => p.sorteio === m.id && p.situacao !== 'aRevisar'))
          throw recusaVersaoGestao('O sorteio');
        const x = conferida(s.sorteiosRev, m.id, m.versao, (y) => !y.canceladoEm, 'O sorteio');
        versionar('sorteio_revisao_prontuario', x, 'cancelamento', m.motivo, m.usuario, m.agora);
        s.sorteiosRev = troca(s.sorteiosRev, {
          ...x,
          canceladoEm: segundos(m.agora),
          canceladoPor: m.usuario,
          motivoCancelamento: m.motivo,
          versao: m.versao + 1,
        });
        return { versao: m.versao + 1 };
      },
      revisarProntuario: async (r) => {
        const x = conferida(s.prontuariosRev, r.id, r.versao, (y) => !y.avalEm, 'O prontuário');
        if (r.justificativa !== null)
          versionar('revisao_prontuario', x, 'correcao', r.justificativa, r.usuario, r.agora);
        s.prontuariosRev = troca(s.prontuariosRev, {
          ...x,
          situacao: r.situacao,
          respostas: r.respostas,
          observacao: r.observacao,
          revisadoPor: r.usuario,
          revisadoEm: segundos(r.agora),
          versao: r.versao + 1,
        });
        const existentes = s.pendenciasRev.filter((p) => p.prontuario === r.id);
        const itens = new Set(r.pendencias.map((p) => p.item));
        for (const p of r.pendencias) {
          const ja = existentes.find((e) => e.item === p.item);
          if (!ja)
            s.pendenciasRev.push({
              id: id(),
              prontuario: r.id,
              reg: x.reg,
              item: p.item,
              descricao: p.descricao,
              profissionalRegistro: r.profissional.registro,
              profissionalLogin: r.profissional.login ? r.profissional.login.toUpperCase() : null,
              profissionalNome: r.profissional.nome,
              prazo: p.prazo,
              situacao: 'aberta',
              resposta: null,
              resolvidaPor: null,
              resolvidaEm: null,
              canceladaPor: null,
              canceladaEm: null,
              motivoCancelamento: null,
              criadaEm: segundos(r.agora),
              versao: 1,
            });
          else if (ja.situacao === 'cancelada') {
            versionar(
              'pendencia_prontuario',
              ja,
              'reabertura',
              r.justificativa ?? 'Reaberta.',
              r.usuario,
              r.agora,
            );
            s.pendenciasRev = troca(s.pendenciasRev, {
              ...ja,
              situacao: 'aberta',
              descricao: p.descricao,
              prazo: p.prazo,
              canceladaPor: null,
              canceladaEm: null,
              motivoCancelamento: null,
              versao: ja.versao + 1,
            });
          }
        }
        for (const e of existentes)
          if (e.situacao === 'aberta' && !itens.has(e.item)) {
            const motivo = `Revisão corrigida: ${r.justificativa ?? ''}`.slice(0, 500);
            versionar('pendencia_prontuario', e, 'cancelamento', motivo, r.usuario, r.agora);
            s.pendenciasRev = troca(s.pendenciasRev, {
              ...e,
              situacao: 'cancelada',
              canceladaPor: r.usuario,
              canceladaEm: segundos(r.agora),
              motivoCancelamento: motivo,
              versao: e.versao + 1,
            });
          }
        return { versao: r.versao + 1 };
      },
      avalRevisao: async (a) => {
        if (s.pendenciasRev.some((p) => p.prontuario === a.id && p.situacao === 'aberta'))
          throw recusaVersaoGestao('O prontuário');
        const x = conferida(
          s.prontuariosRev,
          a.id,
          a.versao,
          (y) => !y.avalEm && y.situacao !== 'aRevisar',
          'O prontuário',
        );
        s.prontuariosRev = troca(s.prontuariosRev, {
          ...x,
          avalPor: a.usuario,
          avalEm: segundos(a.agora),
          versao: a.versao + 1,
        });
        return { versao: a.versao + 1 };
      },
      responderPendenciaRevisao: async (p) => {
        const x = conferida(s.pendenciasRev, p.id, p.versao, (y) => y.situacao === 'aberta', 'A pendência');
        s.pendenciasRev = troca(s.pendenciasRev, {
          ...x,
          situacao: 'resolvida',
          resposta: p.resposta,
          resolvidaPor: p.usuario,
          resolvidaEm: segundos(p.agora),
          versao: p.versao + 1,
        });
        return { versao: p.versao + 1 };
      },
      cancelarPendenciaRevisao: async (m) => {
        const x = conferida(s.pendenciasRev, m.id, m.versao, (y) => y.situacao === 'aberta', 'A pendência');
        versionar('pendencia_prontuario', x, 'cancelamento', m.motivo, m.usuario, m.agora);
        s.pendenciasRev = troca(s.pendenciasRev, {
          ...x,
          situacao: 'cancelada',
          canceladaPor: m.usuario,
          canceladaEm: segundos(m.agora),
          motivoCancelamento: m.motivo,
          versao: m.versao + 1,
        });
        return { versao: m.versao + 1 };
      },
      alterarAuditoria: async (a) => {
        const x = conferida(s.auditorias, a.id, a.versao, (y) => !y.canceladaEm, 'A auditoria');
        versionar('auditoria_interna', x, 'correcao', a.justificativa, a.usuario, a.agora);
        s.auditorias = troca(s.auditorias, {
          ...x,
          titulo: a.titulo,
          area: a.area,
          realizadaEm: a.realizadaEm,
          auditores: a.auditores,
          itens: a.itens,
          ...a.contagens,
          conclusao: a.conclusao,
          versao: a.versao + 1,
        });
        return { versao: a.versao + 1 };
      },
      cancelarAuditoria: async (a) => {
        const x = conferida(s.auditorias, a.id, a.versao, (y) => !y.canceladaEm, 'A auditoria');
        versionar('auditoria_interna', x, 'cancelamento', a.justificativa, a.usuario, a.agora);
        s.auditorias = troca(s.auditorias, {
          ...x,
          canceladaEm: segundos(a.agora),
          motivoCancelamento: a.justificativa,
          versao: a.versao + 1,
        });
        if ((await this.dependentes(_c, 'auditoria_interna', x.id)).length)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        return { versao: a.versao + 1 };
      },
      retificarAta: async (r) => {
        const x = conferida(s.reunioes, r.id, r.versao, (y) => !y.canceladaEm, 'A reunião');
        if (!!r.assinaturaAtual !== !!x.ataAssinadaEm) throw recusaVersaoGestao('A reunião');
        versionar('reuniao_comissao', x, 'retificacao', r.justificativa, r.usuario, r.agora);
        s.reunioes = troca(s.reunioes, {
          ...x,
          ...(r.assinaturaAtual
            ? {
                ataAssinadaEm: null,
                ataAssinadaPor: null,
                assinaturaAnteriorEm: segundos(r.assinaturaAtual.em),
                assinaturaAnteriorPor: r.assinaturaAtual.por,
              }
            : {}),
          pauta: r.pauta,
          ata: r.ata,
          presentes: r.presentes,
          presentesTotal: r.presentesTotal,
          convidados: r.convidados,
          deliberacoes: r.deliberacoes,
          versao: r.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      assinarAta: async (r) => {
        const x = conferida(
          s.reunioes,
          r.id,
          r.versao,
          (y) => !y.canceladaEm && !y.ataAssinadaEm,
          'A reunião',
        );
        s.reunioes = troca(s.reunioes, {
          ...x,
          ataAssinadaEm: segundos(r.agora),
          ataAssinadaPor: r.usuario,
          versao: r.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      cancelarReuniao: async (r) => {
        const x = conferida(
          s.reunioes,
          r.id,
          r.versao,
          (y) => !y.canceladaEm && !y.ataAssinadaEm && !y.assinaturaAnteriorEm,
          'A reunião',
        );
        versionar('reuniao_comissao', x, 'cancelamento', r.justificativa, r.usuario, r.agora);
        s.reunioes = troca(s.reunioes, {
          ...x,
          canceladaEm: segundos(r.agora),
          motivoCancelamento: r.justificativa,
          versao: r.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      cancelarNaoConformidade: async (n) => {
        const x = conferida(
          s.ncs,
          n.id,
          n.versao,
          (y) => !y.canceladaEm && y.situacao === 'aberta',
          'A não conformidade',
        );
        versionar('nao_conformidade_qualidade', x, 'cancelamento', n.justificativa, n.usuario, n.agora);
        s.ncs = troca(s.ncs, {
          ...x,
          canceladaEm: segundos(n.agora),
          motivoCancelamento: n.justificativa,
          duplicadaDe: n.duplicadaDe,
          versao: n.versao + 1,
        });
        if ((await this.dependentes(_c, 'nao_conformidade_qualidade', x.id)).length)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        return { versao: n.versao + 1 };
      },
      corrigirManifestacao: async (m) => {
        const x = conferida(
          s.manifestacoes,
          m.id,
          m.versao,
          (y) => !y.canceladaEm && y.situacao === 'aberta',
          'A manifestação',
        );
        versionar('manifestacao_ouvidoria', x, 'correcao', m.justificativa, m.usuario, m.agora);
        s.manifestacoes = troca(s.manifestacoes, {
          ...x,
          tipo: m.tipo,
          area: m.area,
          relato: m.relato,
          versao: m.versao + 1,
        });
        return { versao: m.versao + 1 };
      },
      cancelarManifestacao: async (m) => {
        const x = conferida(s.manifestacoes, m.id, m.versao, (y) => !y.canceladaEm, 'A manifestação');
        versionar('manifestacao_ouvidoria', x, 'cancelamento', m.justificativa, m.usuario, m.agora);
        s.manifestacoes = troca(s.manifestacoes, {
          ...x,
          canceladaEm: segundos(m.agora),
          motivoCancelamento: m.justificativa,
          versao: m.versao + 1,
        });
        if ((await this.dependentes(_c, 'manifestacao_ouvidoria', x.id)).length)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        return { versao: m.versao + 1 };
      },
      ...gravacoesAprovacaoMemoria(s, id),
      publicarDocumento: async (d) => {
        if (d.substitui) {
          const v = versao(s.documentos, d.substitui.id, d.substitui.versao, 'O documento');
          if (v.situacao !== 'vigente' || v.codigo !== d.codigo) throw recusaVersaoGestao('O documento');
          s.documentos = troca(s.documentos, {
            ...v,
            situacao: 'obsoleto',
            encerradoEm: segundos(d.agora),
            versao: v.versao + 1,
          });
        }
        if (s.documentos.some((x) => x.codigo === d.codigo && x.revisao === d.revisao))
          throw recusaVersaoGestao('O documento');
        const novo = id();
        s.documentos.push({
          id: novo,
          versao: 1,
          codigo: d.codigo,
          revisao: d.revisao,
          tipo: d.tipo,
          titulo: d.titulo,
          area: d.area,
          resumoAlteracao: d.resumoAlteracao,
          elaboradoPor: d.elaboradoPor,
          revisadoPor: d.revisadoPor,
          aprovadoPor: d.usuario,
          publicadoEm: segundos(d.agora),
          vigenciaAte: d.vigenciaAte,
          exigeCiencia: d.exigeCiencia,
          hash: d.hash,
          situacao: 'vigente',
          motivoRetirada: null,
          encerradoEm: null,
          conteudo: d.conteudo,
        });
        return { id: novo };
      },
      retirarDocumento: async (r) => {
        const v = versao(s.documentos, r.id, r.versao, 'O documento');
        // A mesma regra da porta própria (conferirRetirada): só a vigente, na versão lida, com motivo escrito.
        if (conferirRetirada(v, r)) throw recusaVersaoGestao('O documento');
        s.documentos = troca(s.documentos, {
          ...v,
          situacao: 'retirado',
          motivoRetirada: r.motivo,
          encerradoEm: segundos(r.agora),
          versao: v.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      registrarCiencia: async (c) => {
        const d = s.documentos.find((x) => x.id === c.documento);
        if (d?.situacao !== 'vigente')
          throw recusa('documento-nao-vigente', 'O documento não está mais vigente: abra a revisão nova.');
        const u = c.usuario.toUpperCase();
        if (s.ciencias.some((x) => x.documento === c.documento && x.usuario === u))
          throw recusa('ciencia-ja-registrada', 'Você já registrou a ciência desta revisão.');
        const novo = id();
        s.ciencias.push({ id: novo, documento: c.documento, usuario: u, cienteEm: segundos(c.agora) });
        return { id: novo };
      },
      registrarAnaliseIndicador: async (a) => {
        if ((a.responsavel?.trim() ? 1 : 0) + (a.prazo !== null ? 1 : 0) === 1)
          throw recusa(
            'plano-incompleto',
            'O plano de ação precisa do responsável e do prazo juntos (ou de nenhum dos dois).',
          );
        const dados = {
          numerador: a.numerador,
          denominador: a.denominador,
          valor: a.valor,
          meta: a.meta,
          situacaoMeta: a.situacaoMeta,
          texto: a.texto,
          causas: a.causas,
          plano: a.plano,
          responsavel: a.responsavel,
          prazo: a.prazo,
        };
        if (a.id === null) {
          if (s.analises.some((x) => x.indicador === a.indicador && x.competencia === a.competencia))
            throw recusa(
              'analise-ja-registrada',
              'Outra pessoa registrou a análise deste indicador nesta competência: recarregue e altere a registrada.',
            );
          const novo = id();
          s.analises.push({
            id: novo,
            versao: 1,
            indicador: a.indicador,
            competencia: a.competencia,
            ...dados,
            registradaPor: a.usuario,
            registradaEm: segundos(a.agora),
            atualizadaPor: null,
            atualizadaEm: null,
          });
          return { id: novo, versao: 1, criada: true };
        }
        const v = versao(s.analises, a.id, a.versao, 'A análise');
        s.analises = troca(s.analises, {
          ...v,
          ...dados,
          atualizadaPor: a.usuario,
          atualizadaEm: segundos(a.agora),
          versao: v.versao + 1,
        });
        return { id: a.id, versao: v.versao + 1, criada: false };
      },
      registrarAuditoria: async (a) => {
        const novo = id();
        s.auditorias.push({
          id: novo,
          titulo: a.titulo,
          area: a.area,
          referencial: a.referencial,
          realizadaEm: a.realizadaEm,
          auditores: a.auditores,
          itens: a.itens,
          conformes: a.conformes,
          parciais: a.parciais,
          naoConformes: a.naoConformes,
          naoAplicaveis: a.naoAplicaveis,
          conclusao: a.conclusao,
          registradaPor: a.usuario,
          registradaEm: segundos(a.agora),
        });
        return { id: novo };
      },
      registrarComissao: async (c) => {
        if (s.comissoes.some((x) => x.nome === c.nome && x.id !== c.id))
          throw recusa('comissao-duplicada', 'Já existe comissão com este nome.');
        const dados = {
          tipo: c.tipo,
          nome: c.nome,
          periodicidade: c.periodicidade,
          membros: c.membros,
          ativa: c.ativa,
        };
        if (c.id === null) {
          const novo = id();
          s.comissoes.push({
            id: novo,
            versao: 1,
            ...dados,
            registradaEm: segundos(c.agora),
            ultimaOrdinaria: null,
            ultimaReuniao: null,
          });
          return { id: novo, versao: 1, criada: true };
        }
        const v = versao(s.comissoes, c.id, c.versao, 'A comissão');
        versionar(
          'comissao_hospitalar',
          v,
          c.ativa ? 'correcao' : 'cancelamento',
          c.justificativa ?? 'Alteração da comissão',
          c.usuario,
          c.agora,
        );
        s.comissoes = troca(s.comissoes, { ...v, ...dados, versao: v.versao + 1 });
        if (c.conferirDependentes && (await this.dependentes(_c, 'comissao_hospitalar', c.id)).length)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        return { id: c.id, versao: v.versao + 1, criada: false };
      },
      registrarReuniaoComissao: async (r) => {
        const c = versao(s.comissoes, r.comissao, r.versaoComissao, 'A comissão');
        if (!c.ativa) throw recusa('comissao-inativa', 'A comissão está inativa.');
        const novo = id();
        s.reunioes.push({
          id: novo,
          comissao: r.comissao,
          tipo: r.tipo,
          realizadaEm: segundos(r.realizadaEm),
          pauta: r.pauta,
          ata: r.ata,
          presentes: r.presentes,
          membrosTotal: r.membrosTotal,
          presentesTotal: r.presentesTotal,
          convidados: r.convidados,
          deliberacoes: r.deliberacoes,
          registradaPor: r.usuario,
          registradaEm: segundos(r.agora),
        });
        return { id: novo };
      },
      registrarRisco: async (r) => {
        const dados = {
          titulo: r.titulo,
          descricao: r.descricao,
          area: r.area,
          categoria: r.categoria,
          gravidade: r.gravidade,
          urgencia: r.urgencia,
          tendencia: r.tendencia,
          pontuacao: r.gravidade * r.urgencia * r.tendencia,
          controles: r.controles,
          responsavel: r.responsavel,
          situacao: r.situacao,
          reavaliarEm: r.reavaliarEm,
          justificativa: r.justificativa,
        };
        if (r.id === null) {
          const novo = id();
          s.riscos.push({
            id: novo,
            versao: 1,
            ...dados,
            controlesLista: controlesGravados(r.controlesLista ?? [], [], r.agora),
            registradoPor: r.usuario,
            registradoEm: segundos(r.agora),
            atualizadoPor: null,
            atualizadoEm: null,
          });
          return { id: novo, versao: 1, criado: true };
        }
        const v = versao(s.riscos, r.id, r.versao, 'O risco');
        if (v.situacao === 'encerrado') throw recusaVersaoGestao('O risco');
        s.riscos = troca(s.riscos, {
          ...v,
          ...dados,
          controlesLista: r.controlesLista
            ? controlesGravados(r.controlesLista, v.controlesLista, r.agora)
            : v.controlesLista,
          atualizadoPor: r.usuario,
          atualizadoEm: segundos(r.agora),
          versao: v.versao + 1,
        });
        return { id: r.id, versao: v.versao + 1, criado: false };
      },
      registrarNaoConformidade: async (n) => {
        const encerra = n.situacao === 'encerrada';
        const dados = {
          descricao: n.descricao,
          area: n.area,
          classificacao: n.classificacao,
          acaoImediata: n.acaoImediata,
          causa: n.causa,
          plano: n.plano,
          responsavel: n.responsavel,
          prazo: n.prazo,
          situacao: n.situacao,
          eficacia: n.eficacia,
          eficaciaTexto: n.eficaciaTexto,
          encerradaPor: encerra ? n.usuario : null,
          encerradaEm: encerra ? segundos(n.agora) : null,
        };
        if (n.id === null) {
          // A mesma trava da gravação no banco: a origem cancelada não recebe NC nova.
          const origem =
            n.idOrigem === null
              ? null
              : n.origem === 'auditoria'
                ? s.auditorias.find((a) => a.id === n.idOrigem)
                : n.origem === 'ouvidoria'
                  ? s.manifestacoes.find((m) => m.id === n.idOrigem)
                  : null;
          if (origem?.canceladaEm) throw recusa('origem-cancelada', 'O registro de origem foi cancelado.');
          const novo = id();
          s.ncs.push({
            id: novo,
            versao: 1,
            origem: n.origem,
            idOrigem: n.idOrigem,
            ...dados,
            registradaPor: n.usuario,
            registradaEm: segundos(n.agora),
          });
          return { id: novo, versao: 1, criada: true };
        }
        const v = versao(s.ncs, n.id, n.versao, 'A não conformidade');
        if (v.situacao === 'encerrada') throw recusaVersaoGestao('A não conformidade');
        s.ncs = troca(s.ncs, { ...v, ...dados, versao: v.versao + 1 });
        return { id: n.id, versao: v.versao + 1, criada: false };
      },
      registrarManifestacao: async (m) => {
        if (m.pesquisa !== null && s.manifestacoes.some((x) => x.pesquisa === m.pesquisa))
          throw recusa('pesquisa-ja-convertida', 'Esta resposta da pesquisa já virou manifestação.');
        const novo = id();
        const protocolo = m.protocoloDe(novo);
        s.manifestacoes.push({
          id: novo,
          versao: 1,
          protocolo,
          canal: m.canal,
          tipo: m.tipo,
          identificada: m.identificada,
          paciente: m.identificada ? m.paciente : null,
          manifestante: m.identificada ? m.manifestante : null,
          contato: m.identificada ? m.contato : null,
          area: m.area,
          relato: m.relato,
          recebidaEm: segundos(m.recebidaEm),
          prazoEm: segundos(m.prazoEm),
          situacao: 'aberta',
          encaminhadaA: null,
          observacao: null,
          resposta: null,
          procedente: null,
          respondidaPor: null,
          respondidaEm: null,
          pesquisa: m.pesquisa,
          registradaPor: m.usuario,
          registradaEm: segundos(m.agora),
        });
        return { id: novo, protocolo };
      },
      encaminharManifestacao: async (r) => {
        const v = versao(s.manifestacoes, r.id, r.versao, 'A manifestação');
        if (v.situacao === 'respondida') throw recusaVersaoGestao('A manifestação');
        s.manifestacoes = troca(s.manifestacoes, {
          ...v,
          situacao: 'encaminhada',
          encaminhadaA: r.encaminhadaA,
          observacao: r.observacao,
          versao: v.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      responderManifestacao: async (r) => {
        const v = versao(s.manifestacoes, r.id, r.versao, 'A manifestação');
        if (v.situacao === 'respondida') throw recusaVersaoGestao('A manifestação');
        s.manifestacoes = troca(s.manifestacoes, {
          ...v,
          situacao: 'respondida',
          resposta: r.resposta,
          procedente: r.procedente,
          respondidaPor: r.usuario,
          respondidaEm: segundos(r.agora),
          versao: v.versao + 1,
        });
        return { versao: r.versao + 1 };
      },
      gerarEnvioRegulatorio: async (e) => {
        const ant = s.envios.filter((x) => x.tipo === e.tipo && x.competencia === e.competencia);
        if (ant.some((x) => x.situacao === 'transmitido'))
          throw recusa(
            'ja-transmitido',
            'O envio desta competência já foi transmitido: a retificação se faz no portal do programa.',
          );
        const revisao = Math.max(0, ...ant.map((x) => x.revisao)) + 1;
        s.envios = s.envios.map((x) =>
          ant.includes(x) && x.situacao === 'gerado'
            ? { ...x, situacao: 'substituido', versao: x.versao + 1 }
            : x,
        );
        const novo = id();
        const arquivo = e.arquivoDe(revisao);
        s.envios.push({
          id: novo,
          versao: 1,
          tipo: e.tipo,
          competencia: e.competencia,
          revisao,
          arquivo,
          hash: e.hash,
          linhas: e.linhas,
          resumo: e.resumo,
          situacao: 'gerado',
          geradoPor: e.usuario,
          geradoEm: segundos(e.agora),
          transmitidoEm: null,
          transmitidoPor: null,
          protocolo: null,
        });
        return { id: novo, revisao, arquivo };
      },
      registrarTransmissaoEnvio: async (t) => {
        const v = versao(s.envios, t.id, t.versao, 'O envio');
        if (v.situacao !== 'gerado' || v.hash !== t.hash) throw recusaVersaoGestao('O envio');
        s.envios = troca(s.envios, {
          ...v,
          situacao: 'transmitido',
          transmitidoEm: segundos(t.transmitidoEm),
          transmitidoPor: t.usuario,
          protocolo: t.protocolo,
          versao: v.versao + 1,
        });
        return { versao: t.versao + 1 };
      },
    };
    try {
      return await fn(g);
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }
}
