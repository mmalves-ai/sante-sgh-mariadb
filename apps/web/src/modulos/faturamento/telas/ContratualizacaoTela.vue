<script setup lang="ts">
// Contratualização SUS (M55, etapa 5; ficha, seção 7: `/faturamento/sus/contratualizacao`; regra 11; cap-07 §7.3;
// DP-13 e DP-35). Os contratos com o gestor do SUS (lista, cadastro com incentivos, alteração e encerramento pela
// versão), as metas quantitativas (grupo SIGTAP) e qualitativas (indicador), o painel produção × meta com a apuração e o
// repasse estimado, e a consulta das tabelas de apoio. A leitura pela permissão faturamento.contratualizacao.ler; as
// ações só com a funcionalidade ligada no estabelecimento e a permissão de editar (o servidor confere de novo).
import { MENSAGENS_CONTRATUALIZACAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerContratualizacao } from '../api-contratualizacao.js';
import ContratoSusDetalhe from '../componentes/ContratoSusDetalhe.vue';
import ContratoSusFormulario from '../componentes/ContratoSusFormulario.vue';
import {
  podeEditarSus,
  reaisDeCentavos,
  rotuloEsfera,
  rotuloFonte,
  rotuloSituacao,
} from '../componentes/contratualizacao-tela.js';
import DominiosSus from '../componentes/DominiosSus.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { data } from '../usar-faturamento.js';
import './estilo-contratualizacao.css';

const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.${s}`, p ?? {});
const inicio = useQuery({ queryKey: ['contratualizacao', 'inicio'], queryFn: lerContratualizacao });
const dados = computed(() => inicio.data.value ?? null);
const pode = computed(() => podeEditarSus(dados.value?.gravacao));
const incentivosDominio = computed(() => dados.value?.dominios['CMINCENTIVO'] ?? []);
const visao = ref<'contratos' | 'dominios'>('contratos');
const aberto = ref<number | null>(null);
const novo = ref(false);
const mensagem = ref('');

function abrir(id: number): void {
  novo.value = false;
  mensagem.value = '';
  aberto.value = id;
}
async function cadastrado(id: number, m: string): Promise<void> {
  novo.value = false;
  mensagem.value = m;
  await inicio.refetch();
  aberto.value = id;
}
</script>

<template>
  <section class="tela-contratualizacao" aria-labelledby="ct-titulo" data-testid="tela-contratualizacao">
    <h1 id="ct-titulo">{{ k('titulo') }}</h1>
    <p class="secundario">{{ k('subtitulo') }}</p>
    <ErroFaturamento v-if="inicio.isError.value" :erro="inicio.error.value" />
    <p v-else-if="!dados" role="status">{{ k('carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!dados.gravacao.ligada"
        variante="aviso"
        :texto="dados.gravacao.motivo ?? MENSAGENS_CONTRATUALIZACAO.desligado"
        data-testid="ct-desligado"
      />
      <SanteAlerta
        v-if="!dados.parametros.faixasValidas"
        variante="alerta"
        :texto="k('faixasInvalidas')"
        data-testid="ct-faixas-invalidas"
      />
      <p class="secundario" data-testid="ct-fonte">{{ k('fonte', { fonte: rotuloFonte(dados.fonte) }) }}</p>
      <p v-if="mensagem" role="status" data-testid="ct-mensagem">{{ mensagem }}</p>

      <nav class="barra" :aria-label="k('visoes.titulo')">
        <SanteBotao
          :variante="visao === 'contratos' ? 'primario' : 'secundario'"
          :rotulo="k('visoes.contratos')"
          :aria-pressed="visao === 'contratos'"
          data-testid="ct-visao-contratos"
          @acionar="visao = 'contratos'"
        />
        <SanteBotao
          :variante="visao === 'dominios' ? 'primario' : 'secundario'"
          :rotulo="k('visoes.dominios')"
          :aria-pressed="visao === 'dominios'"
          data-testid="ct-visao-dominios"
          @acionar="visao = 'dominios'"
        />
      </nav>

      <DominiosSus v-if="visao === 'dominios'" :dominios="dados.dominios" />

      <ContratoSusFormulario
        v-else-if="novo"
        :pode="pode"
        :incentivos-dominio="incentivosDominio"
        :cnes-sugerido="dados.parametros.cnes"
        @gravado="cadastrado"
        @cancelar="novo = false"
      />

      <ContratoSusDetalhe
        v-else-if="aberto !== null"
        :id="aberto"
        :key="aberto"
        :pode="pode"
        :competencia="dados.competencia"
        :incentivos-dominio="incentivosDominio"
        :cnes-sugerido="dados.parametros.cnes"
        @fechar="aberto = null"
        @mudou="inicio.refetch()"
      />

      <section v-else aria-labelledby="ct-lista-titulo">
        <div class="barra">
          <h2 id="ct-lista-titulo">{{ k('lista.titulo') }}</h2>
          <SanteBotao
            :rotulo="k('lista.novo')"
            :desabilitado="!pode"
            data-testid="ct-novo"
            @acionar="((novo = true), (aberto = null))"
          />
        </div>
        <p v-if="!dados.contratos.length" data-testid="ct-vazio">{{ k('lista.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="ct-lista">
            <thead>
              <tr>
                <th scope="col">{{ k('lista.colNumero') }}</th>
                <th scope="col">{{ k('lista.colEsfera') }}</th>
                <th scope="col">{{ k('lista.colGestor') }}</th>
                <th scope="col">{{ k('lista.colVigencia') }}</th>
                <th scope="col">{{ k('lista.colOrcamento') }}</th>
                <th scope="col">{{ k('lista.colSituacao') }}</th>
                <th scope="col">{{ k('lista.colAcoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.contratos" :key="c.id" :data-testid="`ct-linha-${c.id}`">
                <td>{{ c.numero }}</td>
                <td>{{ rotuloEsfera(c.esfera) }}</td>
                <td>{{ c.gestor }}</td>
                <td>{{ k('lista.vigencia', { inicio: data(c.inicio), fim: data(c.fim) }) }}</td>
                <td>
                  {{
                    k('lista.orcamento', {
                      pre: reaisDeCentavos(c.valorPreMensalCentavos),
                      pos: reaisDeCentavos(c.valorPosMensalCentavos),
                    })
                  }}
                </td>
                <td>{{ rotuloSituacao(c.situacao) }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="k('lista.abrir', { numero: c.numero })"
                    :data-testid="`ct-abrir-${c.id}`"
                    @acionar="abrir(c.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="dados.cortada" class="secundario">{{ k('lista.cortada') }}</p>
      </section>
    </template>
  </section>
</template>
