// M60, etapa 2: a conferência da instalação do estabelecimento ativo (ficha do M60, M60-F2 "Conexão ao banco"; regras
// 5 e 6). Junta a versão instalada, a leitura da conexão corrente e as migrações registradas com as migrações do
// pacote instalado (os arquivos de db/migracoes, com o hash) e devolve os itens com a situação: as regras gerais em
// @sgh/dominio-config e as do motor do banco em ./regras-banco.ts. Só leitura; nenhum segredo, endereço ou dado de
// pessoa sai daqui.
// Melhoria: sem o parâmetro de codificação da convivência: o banco próprio grava texto só em utf8mb4, e a conferência
// exige utf8mb4 no banco e na conexão; o registro das migrações ausente vira alerta com o motivo, não "sem papel".
import { type ConferenciaInstalacao, esquemaConferenciaInstalacao, type Versao } from '@sgh/contratos';
import {
  conferirScripts,
  itensDaConferencia,
  type ScriptDoPacote,
  situacaoDaConferencia,
} from '@sgh/dominio-config';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { ContextoImplantacao, MigracaoRegistrada, PortaImplantacao } from '../porta.js';
import { itensDoMotor } from './regras-banco.js';

export interface DependenciasConferencia {
  readonly porta: PortaImplantacao;
  readonly ambiente: string;
  /** As migrações do pacote instalado (lidas uma vez, sob demanda). */
  readonly scriptsDoPacote: () => readonly ScriptDoPacote[];
  readonly versao: () => Versao;
  /** A identificação que o pacote promete (SONDA_VERSAO_ESPERADA); nula: só mostra a instalada. */
  readonly identificacaoEsperada: string | null;
  /** Mantida na assinatura para a montagem do módulo; a conferência não lê parâmetro. */
  readonly configuracao?: FonteConfiguracao | null;
  readonly agora?: () => number;
}

export class ServicoConferenciaInstalacao {
  constructor(private readonly d: DependenciasConferencia) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  conferir(s: SessaoCadastro): Promise<ConferenciaInstalacao> {
    return this.conferirContexto({ rede: s.rede, hospital: s.hospital });
  }

  /** A mesma conferência sem sessão (a sonda da implantação, com o segredo do pipeline). */
  async conferirContexto(c: ContextoImplantacao): Promise<ConferenciaInstalacao> {
    // allSettled: a falha ao ler o registro das migrações (a conta sem o direito) não derruba a conferência; a leitura
    // da conexão (conta, papel, canal) sempre chega à tela, e o item das migrações sai em falha.
    const [rLida, rRegistradas] = await Promise.allSettled([
      this.d.porta.conexao(c),
      this.d.porta.migracoesRegistradas(c),
    ]);
    // Sem a leitura da conexão não há o que conferir (o banco não respondeu): o erro segue.
    if (rLida.status === 'rejected') throw rLida.reason;
    const lida = rLida.value;
    const registradas: MigracaoRegistrada[] | null | 'sem-registro' =
      rRegistradas.status === 'fulfilled' ? (rRegistradas.value ?? 'sem-registro') : null;
    const versao = this.d.versao();
    const conexao = {
      versaoMotor: lida.versaoMotor,
      charsetBanco: lida.charsetBanco,
      charsetConexao: lida.charsetConexao,
      charsetParametro: 'UTF8' as const,
      autenticacao: lida.autenticacao,
      canalCifrado: lida.canalCifrado,
      canalComprimido: lida.canalComprimido,
      protocolo: lida.protocolo,
      conta: lida.conta,
      papel: lida.papel,
    };
    const pacote = this.d.scriptsDoPacote();
    const scripts = conferirScripts(pacote, registradas === 'sem-registro' ? null : registradas);
    const gerais = itensDaConferencia({
      ambiente: this.d.ambiente,
      conexao,
      scripts,
      charsetParametro: 'UTF8',
      identificacao: versao.identificacao,
      identificacaoEsperada: this.d.identificacaoEsperada,
    });
    const itens = itensDoMotor(gerais, lida, this.d.ambiente, registradas, scripts.noPacote);
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
