// M60, etapa 2: a conferência da instalação do estabelecimento ativo (ficha do M60, M60-F2 "Conexão ao banco"; regras
// 5 e 6). Junta a versão instalada, a leitura da conexão corrente e os scripts registrados com os scripts do pacote
// instalado (os arquivos SGH_ do próprio pacote, com o hash) e devolve os itens com a situação (regras puras em
// @sgh/dominio-config). Só leitura; nenhum segredo, endereço ou dado de pessoa sai daqui.
import {
  type CharsetLegado,
  type ConferenciaInstalacao,
  definicaoParametro,
  esquemaConferenciaInstalacao,
  NOMES_CHARSET_FIREBIRD,
  PARAMETRO_CHARSET_LEGADO,
  type Versao,
} from '@sgh/contratos';
import {
  conferirScripts,
  itensDaConferencia,
  resolverParametro,
  type ScriptDoPacote,
  situacaoDaConferencia,
  valorTipado,
} from '@sgh/dominio-config';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { ContextoImplantacao, PortaImplantacao } from '../porta.js';

export interface DependenciasConferencia {
  readonly porta: PortaImplantacao;
  readonly ambiente: string;
  /** Os scripts SGH_ do pacote instalado (lidos uma vez, sob demanda). */
  readonly scriptsDoPacote: () => readonly ScriptDoPacote[];
  readonly versao: () => Versao;
  /** A identificação que o pacote promete (SONDA_VERSAO_ESPERADA); nula: só mostra a instalada. */
  readonly identificacaoEsperada: string | null;
  readonly configuracao?: FonteConfiguracao | null;
  readonly agora?: () => number;
}

export class ServicoConferenciaInstalacao {
  constructor(private readonly d: DependenciasConferencia) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  /** O parâmetro legado.charset do estabelecimento (padrão CP1252 sem a fonte de configuração). */
  private async charsetParametro(c: ContextoImplantacao): Promise<CharsetLegado> {
    const def = definicaoParametro(PARAMETRO_CHARSET_LEGADO);
    if (!def || !this.d.configuracao) return 'CP1252';
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = await this.d.configuracao.valoresParametro(c.rede, c.hospital);
    } catch {
      valores = [];
    }
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        { rede: c.rede, empresa: null, estabelecimento: c.hospital, unidade: null, perfis: [], usuario: '' },
        new Date(this.agora()),
      ).valor,
    );
    return v === 'UTF8' ? 'UTF8' : 'CP1252';
  }

  conferir(s: SessaoCadastro): Promise<ConferenciaInstalacao> {
    return this.conferirContexto({ rede: s.rede, hospital: s.hospital });
  }

  /** A mesma conferência sem sessão (a sonda da implantação, com o segredo do pipeline). */
  async conferirContexto(c: ContextoImplantacao): Promise<ConferenciaInstalacao> {
    // allSettled: a falha ao ler o registro dos scripts (a conta sem o papel) não derruba a conferência; a leitura
    // da conexão (conta, papel, canal) sempre chega à tela, e o item dos scripts sai em falha.
    const [rLida, rRegistrados, rCharset] = await Promise.allSettled([
      this.d.porta.conexao(c),
      this.d.porta.scriptsRegistrados(c),
      this.charsetParametro(c),
    ]);
    // Sem a leitura da conexão não há o que conferir (o banco não respondeu): o erro segue.
    if (rLida.status === 'rejected') throw rLida.reason;
    const lida = rLida.value;
    const registrados = rRegistrados.status === 'fulfilled' ? rRegistrados.value : null;
    const charsetParametro: CharsetLegado = rCharset.status === 'fulfilled' ? rCharset.value : 'CP1252';
    const versao = this.d.versao();
    const conexao = {
      versaoMotor: lida.versaoMotor,
      charsetBanco: lida.charsetBanco,
      charsetConexao:
        lida.charsetConexaoId === null
          ? null
          : (NOMES_CHARSET_FIREBIRD[lida.charsetConexaoId] ?? `id ${lida.charsetConexaoId}`),
      charsetParametro,
      autenticacao: lida.autenticacao,
      canalCifrado: lida.canalCifrado,
      canalComprimido: lida.canalComprimido,
      protocolo: lida.protocolo,
      conta: lida.conta,
      papel: lida.papel,
    };
    const scripts = conferirScripts(this.d.scriptsDoPacote(), registrados);
    const itens = itensDaConferencia({
      ambiente: this.d.ambiente,
      conexao,
      scripts,
      charsetParametro,
      identificacao: versao.identificacao,
      identificacaoEsperada: this.d.identificacaoEsperada,
    });
    return esquemaConferenciaInstalacao.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      ambiente: this.d.ambiente,
      versao: { identificacao: versao.identificacao, versao: versao.versao },
      conexao,
      scripts,
      itens,
      situacao: situacaoDaConferencia(itens),
    });
  }
}
