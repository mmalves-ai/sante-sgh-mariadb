// Telas de consulta do acesso (M06, ficha seção 7; as de edição são do M10): grupos do legado e perfil
// proposto (acesso.grupo.ler) e mapa opção do legado → permissão (acesso.permissao.ler). Leitura ao vivo,
// auditada (o acesso à administração de acessos é evento da trilha própria).
import { Controller, Get, Inject, Optional, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ACESSO } from '@sgh/contratos';
import { destinoDoGrupo } from '@sgh/dominio-acesso';
import { ErroProblema } from '../../problema.filter.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  type GrupoTela,
  LeituraAcesso,
  NUCLEO_ACESSO,
  type NoMapaTela,
  type NucleoLeituraAcesso,
} from './legado-acesso.js';

@Controller('acesso')
export class ConsultaAcessoController {
  private readonly leitura: LeituraAcesso | null;
  constructor(
    @Inject(NUCLEO_ACESSO) nucleo: NucleoLeituraAcesso | null,
    @Optional() @Inject(FONTE_GESTAO) private readonly gestao: FonteGestao | null = null,
  ) {
    this.leitura = nucleo ? new LeituraAcesso(nucleo) : null;
  }

  /**
   * Revisão W1-01 (achado 6): em dev/ci a gestão grava na MEMÓRIA e a lista é lida ao vivo; os grupos que a própria
   * gestão incluiu neste processo entram na lista (com a situação e a descrição da memória), para a tela mostrar o que
   * ela gravou (renomeado aparece com o nome novo; excluído sai). Os grupos lidos ao vivo ficam como estão.
   */
  private async comCriadosNaMemoria(req: RequisicaoAutorizada, vivos: GrupoTela[]): Promise<GrupoTela[]> {
    const g = this.gestao;
    const s = req.sgh?.sessao;
    const criados = g?.gruposCriadosNaMemoria?.() ?? [];
    if (!g || g.destino !== 'memoria' || !criados.length || !s?.rede || !s.estabelecimentoAtivo) return vivos;
    const rede = s.rede;
    const hospital = s.estabelecimentoAtivo;
    const vistos = new Set(vivos.map((x) => x.grupo));
    const mem = new Map((await g.grupos(rede, hospital)).map((x) => [x.nome, x]));
    const novos = await Promise.all(
      criados
        .filter((n) => !vistos.has(n) && mem.has(n))
        .map(async (n): Promise<GrupoTela> => {
          const m = mem.get(n);
          const d = (await g.versoesDescricaoGrupo(rede, hospital, n)).find((x) => x.situacao === 'vigente');
          const dest = destinoDoGrupo(n);
          return {
            grupo: n,
            ativo: m?.ativo ?? true,
            usuariosAtivos: 0,
            opcoesLegado: m?.opcoes.length ?? 0,
            permissoesNovo: 0,
            destino: dest.tipo,
            perfil: dest.tipo === 'perfil' ? dest.perfil : null,
            nivel: dest.tipo === 'perfil' ? dest.nivel : null,
            motivo: dest.tipo === 'perfil' ? null : dest.motivo,
            descricao: d?.descricao ?? null,
            descricaoVersao: d?.versao ?? null,
          };
        }),
    );
    return [...vivos, ...novos];
  }

  private exigir(req: RequisicaoAutorizada): { l: LeituraAcesso; hospital: string } {
    if (!this.leitura) throw new ServiceUnavailableException('Núcleo do legado não configurado.');
    const hospital = req.sgh?.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { l: this.leitura, hospital };
  }

  @Get('grupos')
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async grupos(@Req() req: RequisicaoAutorizada): Promise<{ grupos: GrupoTela[] }> {
    const { l, hospital } = this.exigir(req);
    return { grupos: await this.comCriadosNaMemoria(req, await l.grupos(hospital)) };
  }

  @Get('mapa')
  @Permissao(PERMISSOES_ACESSO.permissaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async mapa(
    @Req() req: RequisicaoAutorizada,
    @Query('modulo') modulo?: string,
  ): Promise<{ modulos: Awaited<ReturnType<LeituraAcesso['modulos']>>; nos: NoMapaTela[] }> {
    const { l, hospital } = this.exigir(req);
    const modulos = await l.modulos(hospital);
    const id = modulo === undefined || modulo === '' ? null : Number(modulo);
    if (id !== null && (!Number.isInteger(id) || !modulos.some((m) => m.id === id)))
      throw new ErroProblema('entrada-invalida', 400, 'Módulo inválido', 'Escolha um módulo da lista.');
    return { modulos, nos: id === null ? [] : await l.mapa(hospital, id) };
  }
}
