<script setup lang="ts">
// "Concessões da coexistência" (M59-F5; ficha do M59, seção 7 e seção 4; cap-13 §13.2.1): cartão da "Migração
// gradual dos usuários". O termo das seis concessões, cada uma com os requisitos, a situação, a medida do
// endurecimento (lida das telas das etapas anteriores) e o fim previsto. Quem tem auditoria.concessao.encerrar
// (administrador do sistema) prevê o fim, encerra com a evidência e a senha (só com o desligamento concluído, a
// contingência fechada e a medida atendida; o servidor confere) e reabre com o motivo e a senha.
import { type Concessao, PERMISSOES_M59_F5_CODIGOS as P } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { codigoDoErro } from '../../acesso/api-identidade.js';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import {
  buscarConcessoes,
  encerrarConcessao,
  preverConcessao,
  reabrirConcessao,
} from '../../administracao/api-sbis.js';
import { dataCurta, dataHora, textoRecusaSbis } from '../../administracao/sbis-tela.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

type Acao = 'encerrar' | 'reabrir' | 'prever';

const { t } = useI18n();
const qc = useQueryClient();
const podeEditar = computed(() => pode(P.concessaoEncerrar));
const painel = useQuery({ queryKey: ['sbis', 'concessoes'], queryFn: () => buscarConcessoes() });

const alvo = ref<{ c: Concessao; acao: Acao } | null>(null);
const texto = ref('');
const data = ref<string | null>(null);
const senha = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const recusa = computed(() => textoRecusaSbis(codigoDoErro(erro.value)));

const acoes = (c: Concessao): Acao[] =>
  !podeEditar.value ? [] : c.situacao === 'vigente' ? ['prever', 'encerrar'] : ['reabrir'];

function escolher(c: Concessao, acao: Acao): void {
  alvo.value = { c, acao };
  texto.value = '';
  senha.value = '';
  data.value = c.fimPrevisto;
  erro.value = null;
  aviso.value = '';
}

async function confirmar(): Promise<void> {
  if (!alvo.value || ocupado.value) return;
  const { c, acao } = alvo.value;
  const s = senha.value;
  senha.value = '';
  ocupado.value = true;
  erro.value = null;
  try {
    if (acao === 'encerrar') await encerrarConcessao(c.codigo, texto.value.trim(), s);
    else if (acao === 'reabrir') await reabrirConcessao(c.codigo, texto.value.trim(), s);
    else await preverConcessao(c.codigo, data.value);
    aviso.value = t('sbis.concessoes.form.feito');
    alvo.value = null;
    await qc.invalidateQueries({ queryKey: ['sbis'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="concessoes-titulo">
    <h1 id="concessoes-titulo">{{ t('sbis.concessoes.titulo') }}</h1>
    <AbasMigracao atual="concessoes" />
    <p>{{ t('sbis.concessoes.texto') }}</p>
    <p v-if="!podeEditar" data-testid="concessoes-sem-edicao">{{ t('sbis.concessoes.semEdicao') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('sbis.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <ul class="situacao" data-testid="concessoes-situacao">
        <li>
          {{
            t('sbis.concessoes.resumo', {
              vigentes: painel.data.value.vigentes,
              encerradas: painel.data.value.encerradas,
            })
          }}
        </li>
        <li>
          {{
            painel.data.value.desligado ? t('sbis.concessoes.desligado') : t('sbis.concessoes.naoDesligado')
          }}
        </li>
        <li>
          {{
            painel.data.value.contingenciaAtiva
              ? t('sbis.concessoes.contingencia')
              : t('sbis.concessoes.semContingencia')
          }}
        </li>
      </ul>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('sbis.concessoes.legenda')">
        <table data-testid="concessoes-tabela">
          <caption>
            {{
              t('sbis.concessoes.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sbis.concessoes.concessao') }}</th>
              <th scope="col">{{ t('sbis.concessoes.requisitos') }}</th>
              <th scope="col">{{ t('sbis.concessoes.situacao') }}</th>
              <th scope="col">{{ t('sbis.concessoes.medida') }}</th>
              <th scope="col">{{ t('sbis.concessoes.fimPrevisto') }}</th>
              <th scope="col">{{ t('sbis.concessoes.evidencia') }}</th>
              <th scope="col">{{ t('sbis.concessoes.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in painel.data.value.concessoes"
              :key="c.codigo"
              :data-testid="`concessao-${c.codigo}`"
            >
              <th scope="row">{{ c.titulo }}</th>
              <td>{{ c.requisitos.join(', ') }}</td>
              <td>
                {{ t(`sbis.concessoes.situacoes.${c.situacao}`) }}
                <small v-if="c.encerradaPor" class="linha">
                  {{
                    t('sbis.concessoes.encerradaPor', { por: c.encerradaPor, em: dataHora(c.encerradaEm) })
                  }}
                </small>
                <small v-if="c.reabertaPor" class="linha">
                  {{
                    t('sbis.concessoes.reabertaPor', {
                      por: c.reabertaPor,
                      em: dataHora(c.reabertaEm),
                      motivo: c.motivoReabertura ?? '',
                    })
                  }}
                </small>
              </td>
              <td :data-testid="`concessao-medida-${c.codigo}`">
                <strong>{{ t(`sbis.concessoes.indicadores.${c.indicador}`) }}</strong>
                <small class="linha">{{ c.medida }}</small>
                <small v-if="c.recusa" class="linha">{{ c.recusa }}</small>
              </td>
              <td>{{ dataCurta(c.fimPrevisto) }}</td>
              <td>{{ c.evidencia ?? '—' }}</td>
              <td class="acoes">
                <SanteBotao
                  v-for="a in acoes(c)"
                  :key="a"
                  :rotulo="t(`sbis.concessoes.${a}`, { titulo: c.titulo })"
                  variante="texto"
                  :desabilitado="ocupado"
                  :data-testid="`concessao-${a}-${c.codigo}`"
                  @acionar="escolher(c, a)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="concessoes-aviso" />
      <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" anunciar data-testid="concessoes-recusa" />
      <MensagemErro v-else-if="erro" :erro="erro" />

      <form v-if="alvo" class="formulario" data-testid="form-concessao" @submit.prevent="confirmar">
        <h2>{{ t(`sbis.concessoes.form.${alvo.acao}`, { titulo: alvo.c.titulo }) }}</h2>
        <template v-if="alvo.acao === 'prever'">
          <SanteData
            v-model="data"
            :rotulo="t('sbis.concessoes.form.data')"
            editavel
            data-testid="concessao-data"
          />
          <small>{{ t('sbis.concessoes.form.dataAjuda') }}</small>
        </template>
        <template v-else>
          <div class="campo">
            <label for="concessao-texto">
              {{
                alvo.acao === 'encerrar'
                  ? t('sbis.concessoes.form.evidencia')
                  : t('sbis.concessoes.form.motivo')
              }}
            </label>
            <textarea
              id="concessao-texto"
              v-model="texto"
              :maxlength="alvo.acao === 'encerrar' ? 1000 : 200"
              :minlength="alvo.acao === 'encerrar' ? 10 : 5"
              rows="3"
              required
              :aria-describedby="alvo.acao === 'encerrar' ? 'concessao-texto-ajuda' : undefined"
              data-testid="concessao-texto"
            />
            <small v-if="alvo.acao === 'encerrar'" id="concessao-texto-ajuda">
              {{ t('sbis.concessoes.form.evidenciaAjuda') }}
            </small>
          </div>
          <SenhaConfirmacao v-model="senha" testid="concessao-senha" />
        </template>
        <div class="botoes">
          <SanteBotao
            :rotulo="
              t(
                `sbis.concessoes.form.${
                  alvo.acao === 'encerrar'
                    ? 'confirmarEncerrar'
                    : alvo.acao === 'reabrir'
                      ? 'confirmarReabrir'
                      : 'confirmarPrever'
                }`,
              )
            "
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="concessao-confirmar"
          />
          <SanteBotao :rotulo="t('sbis.cancelar')" variante="texto" @acionar="alvo = null" />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.situacao {
  margin: var(--sgh-espaco-2) 0;
}
.linha {
  display: block;
  color: var(--sgh-texto-secundario);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin: var(--sgh-espaco-3) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.botoes,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
