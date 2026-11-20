// Telas "Administração > Coexistência com o legado" (M02): estabelecimentos da rede (uma conexão por
// estabelecimento) e verificação de schema dos bancos (versão congelada). Permissões declaradas em
// @sgh/contratos (config.schema.ler / config.schema.verificar / config.estabelecimento.ler). M06: exigem
// sessão e a permissão (guarda global), em qualquer ambiente.
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnApplicationShutdown,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  type EstabelecimentosApi,
  esquemaEstabelecimentos,
  esquemaVerificacaoSchema,
  type VerificacaoSchemaApi,
} from '@sgh/contratos';
import { compararImpressoes, resumirComparacao } from '@sgh/legado';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { FONTE_COEXISTENCIA, type FonteCoexistencia } from './fonte.js';

@Controller('config')
export class CoexistenciaController implements OnApplicationShutdown {
  constructor(@Inject(FONTE_COEXISTENCIA) private readonly fonte: FonteCoexistencia | null) {}

  /** O núcleo entra por useValue: o Nest não o encerra sozinho. Fecha os pools de todos os bancos. */
  async onApplicationShutdown(): Promise<void> {
    await this.fonte?.encerrar?.();
  }

  private exigir(): FonteCoexistencia {
    if (!this.fonte) throw new ServiceUnavailableException('Núcleo do legado não configurado.');
    return this.fonte;
  }

  @Get('estabelecimentos')
  @Permissao('config.estabelecimento.ler')
  estabelecimentos(): EstabelecimentosApi {
    const f = this.exigir();
    const pools = new Map(f.estadosDosPools().map((p) => [p.estabelecimento, p]));
    return esquemaEstabelecimentos.parse({
      rede: f.rede,
      estabelecimentos: f.saude().map((s) => {
        const p = pools.get(s.codigo);
        return {
          codigo: s.codigo,
          nomeConfigurado: s.nomeConfigurado,
          disponivel: s.disponivel,
          motivo: s.motivo,
          conectado: s.conectado,
          nomeConfere: s.nomeConfere,
          nomeNoBanco: s.identificacao?.razaoSocial ?? s.identificacao?.nomeHospital ?? null,
          cnes: s.identificacao?.cnesHospital ?? s.identificacao?.cnesEmpresa ?? null,
          unidades: s.identificacao?.unidades.length ?? 0,
          sysdbaDev: s.sysdbaDev,
          estadoSchema: s.schema?.estado ?? null,
          pool: p ? { abertas: p.abertas, livres: p.livres, emUso: p.emUso } : null,
        };
      }),
    });
  }

  @Get('schema')
  @Permissao('config.schema.ler')
  schema(): VerificacaoSchemaApi {
    return this.montar(this.exigir());
  }

  /** Banco que estava fora é reconectado e tem o nome conferido antes. */
  @Post('schema/verificar')
  @HttpCode(200)
  @Permissao('config.schema.verificar')
  @Auditar(EVENTOS_AUDITAVEIS.schemaVerificado.codigo)
  async verificar(): Promise<VerificacaoSchemaApi> {
    const f = this.exigir();
    for (const e of f.estabelecimentos) await f.verificarSchema(e.codigo);
    return this.montar(f);
  }

  private montar(f: FonteCoexistencia): VerificacaoSchemaApi {
    const marcas = f.saude().flatMap((s) => (s.schema ? [s.schema] : []));
    const impressoes = f.estabelecimentos.flatMap((e) => {
      const i = f.ultimaImpressao(e.codigo);
      return i ? [i] : [];
    });
    const [primeira, ...outras] = impressoes;
    const entreBancos =
      primeira && outras.length > 0
        ? outras.map((o) => {
            const c = compararImpressoes(primeira, o);
            return {
              a: primeira.estabelecimento,
              b: o.estabelecimento,
              iguais: c.iguais,
              resumo: resumirComparacao(c),
            };
          })
        : null;
    return esquemaVerificacaoSchema.parse({ marcas, entreBancos });
  }
}
