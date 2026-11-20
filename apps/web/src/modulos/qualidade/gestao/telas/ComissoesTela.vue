<script setup lang="ts">
// Qualidade e segurança › Gestão da qualidade › Comissões obrigatórias (M48, etapa 5; ficha, seção 7; manual
// "Comissões"). As comissões com a periodicidade e a reunião ordinária atrasada em destaque; a comissão aberta mostra
// as reuniões (pauta, ata, presença e quórum) e registra a nova reunião.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import { rotuloPeriodicidadeComissao, rotuloTipoComissao } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { type ComissaoTela, lerComissoes, lerResumoGestao, lerReunioes } from '../api-gestao.js';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import CorrecoesGestao from '../componentes/CorrecoesGestao.vue';
import ErroGestao from '../componentes/ErroGestao.vue';
import FormularioComissao from '../componentes/FormularioComissao.vue';
import FormularioReuniao from '../componentes/FormularioReuniao.vue';
import NavGestao from '../componentes/NavGestao.vue';
import ResumoGestao from '../componentes/ResumoGestao.vue';
import { dataBr } from '../regras-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const podeRegistrar = computed(() => resumo.data.value?.podeRegistrar ?? false);
const agora = computed(() => resumo.data.value?.agora ?? '');

const lista = useQuery({ queryKey: ['gestaoQualidade', 'comissoes'], queryFn: lerComissoes });
const editando = ref<{ comissao: ComissaoTela | null } | null>(null);
const abertaId = ref<number | null>(null);
const aberta = computed(() => lista.data.value?.itens.find((c) => c.id === abertaId.value) ?? null);
const reunioes = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'reunioes', abertaId.value]),
  queryFn: () => lerReunioes(abertaId.value as number),
  enabled: computed(() => abertaId.value !== null),
});
const novaReuniao = ref(false);
const aviso = ref<string | null>(null);

async function comissaoGravada(id: number): Promise<void> {
  editando.value = null;
  aviso.value = t('gestaoQualidade.comissoes.form.gravada');
  abertaId.value = id;
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}
// W0-04: retificar a ata (nova versão), assinar (crítica) e cancelar a reunião lançada errado (crítica).
const correcoes = ref<InstanceType<typeof CorrecoesGestao> | null>(null);
const nomesMembros = computed(() => aberta.value?.membros.map((m) => m.nome) ?? []);
function alterado(texto: string): void {
  aviso.value = texto;
}
async function reuniaoGravada(): Promise<void> {
  novaReuniao.value = false;
  aviso.value = t('gestaoQualidade.comissoes.reuniao.gravada');
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="comissoes-titulo" data-testid="tela-comissoes">
    <NavGestao />
    <h1 id="comissoes-titulo">{{ t('gestaoQualidade.comissoes.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.comissoes.explicacao') }}</p>
    <ResumoGestao :partes="['gestao']" />
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>
    <div class="linha-ccih">
      <SanteBotao
        v-if="podeRegistrar && !editando"
        :rotulo="t('gestaoQualidade.comissoes.nova')"
        data-testid="com-nova"
        @acionar="editando = { comissao: null }"
      />
    </div>
    <FormularioComissao
      v-if="editando"
      :key="editando.comissao?.id ?? 'nova'"
      :comissao="editando.comissao"
      @gravado="comissaoGravada"
      @cancelar="editando = null"
    />

    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <p v-else-if="!lista.data.value.itens.length" data-testid="com-vazio">
      {{ t('gestaoQualidade.comissoes.nenhuma') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-comissoes">
      <caption>
        {{
          t('gestaoQualidade.comissoes.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('gestaoQualidade.comissoes.colNome') }}</th>
          <th scope="col">{{ t('gestaoQualidade.comissoes.colPeriodicidade') }}</th>
          <th scope="col">{{ t('gestaoQualidade.comissoes.colMembros') }}</th>
          <th scope="col">{{ t('gestaoQualidade.comissoes.colUltima') }}</th>
          <th scope="col">{{ t('gestaoQualidade.comissoes.colProxima') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in lista.data.value.itens" :key="c.id" :data-testid="`comissao-${c.id}`">
          <td>
            <strong>{{ c.nome }}</strong>
            <div class="secundario">{{ rotuloTipoComissao(c.tipo) }}</div>
            <div class="linha-ccih">
              <SanteBotao
                variante="texto"
                :rotulo="t('gestaoQualidade.comissoes.abrir')"
                :data-testid="`abrir-comissao-${c.id}`"
                @acionar="
                  abertaId = c.id;
                  novaReuniao = false;
                "
              />
              <SanteBotao
                v-if="podeRegistrar"
                variante="texto"
                :rotulo="t('gestaoQualidade.comissoes.editar')"
                :data-testid="`editar-comissao-${c.id}`"
                @acionar="editando = { comissao: c }"
              />
              <HistoricoVersoes registro="comissao" :id="c.id" />
            </div>
          </td>
          <td>{{ rotuloPeriodicidadeComissao(c.periodicidade) }}</td>
          <td>{{ c.membros.length }}</td>
          <td>{{ c.ultimaReuniao ? dataHora(c.ultimaReuniao) : '—' }}</td>
          <td>
            {{ dataBr(c.proximaReuniaoAte) || '—' }}
            <div>
              <span v-if="!c.ativa" class="selo selo--neutro">{{
                t('gestaoQualidade.comissoes.inativa')
              }}</span>
              <span v-else-if="c.atrasada" class="prazo prazo--vencido" :data-testid="`atrasada-${c.id}`">{{
                t('gestaoQualidade.comissoes.atrasada')
              }}</span>
              <span v-else class="prazo prazo--cumprido">{{ t('gestaoQualidade.comissoes.emDia') }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="aberta" class="painel-ccih" aria-labelledby="reunioes-titulo" data-testid="reunioes">
      <h2 id="reunioes-titulo">{{ t('gestaoQualidade.comissoes.reunioes', { nome: aberta.nome }) }}</h2>
      <SanteBotao
        v-if="podeRegistrar && aberta.ativa && !novaReuniao && agora"
        :rotulo="t('gestaoQualidade.comissoes.novaReuniao')"
        data-testid="reu-nova"
        @acionar="novaReuniao = true"
      />
      <FormularioReuniao
        v-if="novaReuniao && agora"
        :comissao="aberta"
        :agora="agora"
        @gravado="reuniaoGravada"
        @cancelar="novaReuniao = false"
      />
      <ErroGestao v-if="reunioes.isError.value" :erro="reunioes.error.value" />
      <p v-else-if="!reunioes.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
      <p v-else-if="!reunioes.data.value.itens.length">{{ t('gestaoQualidade.comissoes.nenhumaReuniao') }}</p>
      <article
        v-for="r in reunioes.data.value?.itens ?? []"
        :key="r.id"
        class="painel-ccih"
        :data-testid="`reuniao-${r.id}`"
      >
        <h3>
          {{ dataHora(r.realizadaEm) }} ({{
            r.tipo === 'ordinaria'
              ? t('gestaoQualidade.comissoes.reuniao.ordinaria')
              : t('gestaoQualidade.comissoes.reuniao.extraordinaria')
          }})
          <span v-if="r.canceladaEm" class="selo" :data-testid="`reuniao-inativa-${r.id}`">{{
            t('qualidade.correcao.inativo')
          }}</span>
        </h3>
        <p v-if="r.canceladaEm" class="secundario">
          {{
            t('qualidade.correcao.cancelada', {
              em: dataHora(r.canceladaEm),
              motivo: r.motivoCancelamento ?? '',
            })
          }}
        </p>
        <p v-if="r.ataAssinadaEm" class="prazo prazo--cumprido" :data-testid="`ata-assinada-${r.id}`">
          {{
            t('qualidade.correcao.reuniao.assinadaPor', {
              quem: r.ataAssinadaPor ?? '',
              em: dataHora(r.ataAssinadaEm),
            })
          }}
        </p>
        <p
          v-else-if="r.assinaturaAnteriorEm"
          class="prazo prazo--vencido"
          :data-testid="`ata-aguardando-${r.id}`"
        >
          {{
            t('qualidade.correcao.reuniao.retificadaAposAssinatura', {
              quem: r.assinaturaAnteriorPor ?? '',
              em: dataHora(r.assinaturaAnteriorEm),
            })
          }}
        </p>
        <p :class="r.quorum ? 'prazo prazo--cumprido' : 'prazo prazo--vencido'">
          {{ r.quorum ? t('gestaoQualidade.comissoes.quorum') : t('gestaoQualidade.comissoes.semQuorum') }}:
          {{ r.presentesTotal }} / {{ r.membrosTotal }}
        </p>
        <dl class="ficha-gestao">
          <dt>{{ t('gestaoQualidade.comissoes.presentes') }}</dt>
          <dd>{{ r.presentes.join(', ') }}</dd>
          <dt>{{ t('gestaoQualidade.comissoes.pauta') }}</dt>
          <dd>{{ r.pauta }}</dd>
          <dt>{{ t('gestaoQualidade.comissoes.ata') }}</dt>
          <dd class="conteudo-documento">{{ r.ata }}</dd>
          <template v-if="r.convidados">
            <dt>{{ t('gestaoQualidade.comissoes.convidados') }}</dt>
            <dd>{{ r.convidados }}</dd>
          </template>
          <template v-if="r.deliberacoes">
            <dt>{{ t('gestaoQualidade.comissoes.deliberacoes') }}</dt>
            <dd>{{ r.deliberacoes }}</dd>
          </template>
        </dl>
        <p class="secundario">
          {{
            t('gestaoQualidade.registradoPor', { usuario: r.registradaPor, data: dataHora(r.registradaEm) })
          }}
          · {{ t('qualidade.correcao.versaoAtual', { v: r.versao }) }}
        </p>
        <div class="linha-ccih">
          <template v-if="podeRegistrar && !r.canceladaEm">
            <SanteBotao
              :rotulo="t('qualidade.correcao.reuniao.retificar')"
              variante="secundario"
              :data-testid="`retificar-ata-${r.id}`"
              @acionar="correcoes?.retificarAta(r, nomesMembros)"
            />
            <SanteBotao
              v-if="!r.ataAssinadaEm"
              :rotulo="t('qualidade.correcao.reuniao.assinar')"
              variante="texto"
              :data-testid="`assinar-ata-${r.id}`"
              @acionar="correcoes?.assinarAta(r)"
            />
            <SanteBotao
              v-if="!r.ataAssinadaEm && !r.assinaturaAnteriorEm"
              :rotulo="t('qualidade.correcao.cancelarRegistro')"
              variante="texto"
              :data-testid="`cancelar-reuniao-${r.id}`"
              @acionar="correcoes?.cancelarReuniao(r)"
            />
          </template>
          <HistoricoVersoes registro="reuniao" :id="r.id" />
        </div>
      </article>
      <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="abertaId = null" />
    </section>
    <CorrecoesGestao ref="correcoes" @alterado="alterado" />
  </section>
</template>
