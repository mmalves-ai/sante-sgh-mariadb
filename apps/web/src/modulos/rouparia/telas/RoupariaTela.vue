<script setup lang="ts">
// Rouparia e lavanderia (M55, fatia F2; ficha, seção 7; manual m18 "Rouparia e lavanderia"): `/hotelaria/rouparia`.
// O painel do dia: os envios aguardando o retorno da lavanderia (com o atraso pelo prazo do parâmetro e o atalho para
// registrar o retorno), os movimentos de hoje (com o detalhe e o cancelamento no prazo) e o registro de qualquer
// movimento (coleta pesada, envio, retorno conferido, entrega, perda, inventário).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoRouparia from '../componentes/AvisoRouparia.vue';
import DetalheMovimentoRoupa from '../componentes/DetalheMovimentoRoupa.vue';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import FormMovimentoRoupa from '../componentes/FormMovimentoRoupa.vue';
import NavRouparia from '../componentes/NavRouparia.vue';
import { dataCurta, fmtKg, instanteCurto } from '../regras-rouparia.js';
import { ROTULO_LAVANDERIA, ROTULO_SITUACAO, ROTULO_TIPO, usarPainelRouparia } from '../usar-rouparia.js';

const { t } = useI18n();
const { painel, d, pode, motivoPode, aviso, nomeSetor } = usarPainelRouparia();
const remessa = ref<number | null>(null);
const aberto = ref<number | null>(null);
const mensagem = ref<string | null>(null);
function retornar(id: number): void {
  remessa.value = id;
  document.getElementById('rouparia-registrar')?.scrollIntoView({ block: 'start' });
}
function cancelado(m: string): void {
  mensagem.value = m;
  aberto.value = null;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rouparia-titulo" data-testid="tela-rouparia">
    <h1 id="rouparia-titulo">{{ t('rouparia.titulo') }}</h1>
    <p>{{ t('rouparia.texto') }}</p>
    <NavRouparia />
    <AvisoRouparia :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!d" role="status">{{ t('rouparia.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="rouparia-abertos">
        <h2 id="rouparia-abertos">{{ t('rouparia.painel.abertos') }}</h2>
        <p class="secundario">
          {{
            t('rouparia.painel.prazo', { h: d.parametros.prazoRetornoHoras, tol: d.parametros.toleranciaPct })
          }}
        </p>
        <p v-if="d.enviosAbertos.length === 0">{{ t('rouparia.painel.semAbertos') }}</p>
        <table v-else class="tabela" data-testid="rouparia-abertos">
          <caption>
            {{
              t('rouparia.painel.abertos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('rouparia.tabela.quando') }}</th>
              <th scope="col">{{ t('rouparia.campos.lavanderia') }}</th>
              <th scope="col">{{ t('rouparia.tabela.peso') }}</th>
              <th scope="col">{{ t('rouparia.tabela.pecas') }}</th>
              <th scope="col">{{ t('rouparia.tabela.situacao') }}</th>
              <th scope="col">{{ t('rouparia.tabela.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in d.enviosAbertos"
              :key="e.id"
              :data-testid="`envio-${e.id}`"
              :data-atrasado="e.atrasado"
            >
              <td>{{ dataCurta(e.data) }} · {{ instanteCurto(e.em) }}</td>
              <td>{{ e.lavanderia ? ROTULO_LAVANDERIA[e.lavanderia] : '—' }}</td>
              <td>{{ fmtKg(e.pesoKg) }}</td>
              <td>{{ e.pecas }}</td>
              <td>
                <strong v-if="e.atrasado" class="alerta-texto">{{ t('rouparia.painel.atrasado') }}</strong>
                <span v-else>{{ t('rouparia.painel.noPrazo') }}</span>
                <div class="secundario">{{ t('rouparia.painel.horas', { h: e.horasDesdeEnvio }) }}</div>
              </td>
              <td>
                <SanteBotao
                  v-if="pode"
                  variante="secundario"
                  :rotulo="t('rouparia.painel.registrarRetorno')"
                  :data-testid="`envio-retornar-${e.id}`"
                  @click="retornar(e.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="painel" aria-labelledby="rouparia-hoje">
        <h2 id="rouparia-hoje">{{ t('rouparia.painel.hoje', { dia: dataCurta(d.hoje) }) }}</h2>
        <p v-if="d.cortada" class="secundario">{{ t('rouparia.cortada') }}</p>
        <p v-if="d.movimentosDeHoje.length === 0">{{ t('rouparia.painel.semHoje') }}</p>
        <table v-else class="tabela" data-testid="rouparia-hoje">
          <caption>
            {{
              t('rouparia.painel.hoje', { dia: dataCurta(d.hoje) })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('rouparia.tabela.quando') }}</th>
              <th scope="col">{{ t('rouparia.tabela.tipo') }}</th>
              <th scope="col">{{ t('rouparia.tabela.setor') }}</th>
              <th scope="col">{{ t('rouparia.tabela.peso') }}</th>
              <th scope="col">{{ t('rouparia.tabela.pecas') }}</th>
              <th scope="col">{{ t('rouparia.tabela.situacao') }}</th>
              <th scope="col">{{ t('rouparia.tabela.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in d.movimentosDeHoje"
              :key="m.id"
              :data-testid="`movimento-${m.id}`"
              :data-tipo="m.tipo"
              :data-situacao="m.situacao"
            >
              <td>{{ instanteCurto(m.em) }}</td>
              <td>
                {{ ROTULO_TIPO[m.tipo] }}
                <strong v-if="m.ocorrencia" class="alerta-texto">
                  · {{ t('rouparia.tabela.ocorrencia') }}</strong
                >
              </td>
              <td>{{ nomeSetor(m.centroCusto) ?? t('rouparia.tabela.central') }}</td>
              <td>{{ fmtKg(m.pesoKg) }}</td>
              <td>{{ m.pecas }}</td>
              <td>{{ ROTULO_SITUACAO[m.situacao] }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('rouparia.tabela.detalhe')"
                  :data-testid="`movimento-detalhe-${m.id}`"
                  @click="aberto = m.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <DetalheMovimentoRoupa
        v-if="aberto !== null"
        :id="aberto"
        :painel="d"
        :pode="pode"
        @fechar="aberto = null"
        @cancelado="cancelado"
      />

      <section id="rouparia-registrar" class="painel" aria-labelledby="rouparia-form-titulo">
        <h2 id="rouparia-form-titulo">{{ t('rouparia.form.titulo') }}</h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <FormMovimentoRoupa v-else :painel="d" :remessa="remessa" @gravado="mensagem = null" />
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
