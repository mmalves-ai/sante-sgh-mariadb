<script setup lang="ts">
// Tela "Saúde das conexões e avisos de colisão" (M04): conexões do sistema novo por estabelecimento (pool),
// conexões por sistema no MON$ (quando a conta permite ver: DP-15), transações acima do limite, esperas por
// trava e avisos de colisão (409 de versão e trava ocupada) por operação e por hora. O painel do banco no
// Grafana (M09) completa a tela. Só leitura (config.conexao.ler).
// M35: a carga somada (k6) da consolidação da semana, do relatório de prontidão.
import type { CargaProntidao, PainelConexoes } from '@sgh/contratos';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarCarga, buscarPainelConexoes, totalColisoes } from '../api.js';
import SaudeVigia from '../../internacao/componentes/SaudeVigia.vue';

const { t } = useI18n();
const dados = ref<PainelConexoes | null>(null);
const erro = ref<string | null>(null);
const carga = ref<CargaProntidao | null>(null);
const cargaLida = ref(false);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

onMounted(async () => {
  try {
    dados.value = await buscarPainelConexoes();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
  try {
    carga.value = await buscarCarga();
  } catch {
    carga.value = null;
  } finally {
    cargaLida.value = true;
  }
});
</script>

<template>
  <section aria-labelledby="titulo-conexoes">
    <h1 id="titulo-conexoes">{{ t('config.conexoes.titulo') }}</h1>
    <p>{{ t('config.conexoes.texto') }}</p>
    <p v-if="erro" role="alert">{{ t('config.conexoes.erro', { erro }) }}</p>
    <template v-if="dados">
      <table data-testid="tabela-pools">
        <caption>
          {{
            t('config.conexoes.pools')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('config.conexoes.estabelecimento') }}</th>
            <th scope="col">{{ t('config.conexoes.abertas') }}</th>
            <th scope="col">{{ t('config.conexoes.livres') }}</th>
            <th scope="col">{{ t('config.conexoes.emUso') }}</th>
            <th scope="col">{{ t('config.conexoes.esperando') }}</th>
            <th scope="col">{{ t('config.conexoes.contaDev') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.pools" :key="p.estabelecimento">
            <td>{{ p.estabelecimento }}</td>
            <td>{{ p.abertas }}</td>
            <td>{{ p.livres }}</td>
            <td>{{ p.emUso }}</td>
            <td>{{ p.esperando }}</td>
            <td>{{ p.sysdbaDev ? t('config.conexoes.sim') : t('config.conexoes.nao') }}</td>
          </tr>
        </tbody>
      </table>
      <section
        v-for="(c, e) in dados.coletas"
        :key="e"
        :aria-label="`${t('config.conexoes.porSistema')} ${e}`"
      >
        <h2>{{ t('config.conexoes.porSistema') }}: {{ e }}</h2>
        <p v-if="!c">{{ t('config.conexoes.indisponivel') }}</p>
        <template v-else>
          <table>
            <caption>
              {{
                t('config.conexoes.porSistema')
              }}
              {{
                e
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('config.conexoes.sistema') }}</th>
                <th scope="col">{{ t('config.conexoes.abertas') }}</th>
                <th scope="col">{{ t('config.conexoes.transacoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in c.porSistema" :key="s.sistema">
                <td>{{ s.sistema }}</td>
                <td>{{ s.conexoes }}</td>
                <td>{{ s.transacoes }}</td>
              </tr>
            </tbody>
          </table>
          <p>
            {{
              t('config.conexoes.resumoColeta', {
                acima: c.transacoesAcimaDoLimite,
                esperas: c.esperasPorTrava,
              })
            }}
          </p>
        </template>
      </section>
      <h2>{{ t('config.conexoes.colisoes') }}</h2>
      <p v-if="dados.colisoes.length === 0">{{ t('config.conexoes.semColisoes') }}</p>
      <table v-else data-testid="tabela-colisoes">
        <caption>
          {{
            t('config.conexoes.colisoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('config.gravacao.operacao') }}</th>
            <th scope="col">{{ t('config.conexoes.estabelecimento') }}</th>
            <th scope="col">{{ t('config.conexoes.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in dados.colisoes" :key="`${x.operacao}-${x.estabelecimento}`">
            <td>{{ x.operacao }}</td>
            <td>{{ x.estabelecimento }}</td>
            <td>{{ totalColisoes(x.porHora) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="dados.limitacao">{{ dados.limitacao }}</p>
      <p>
        <router-link :to="{ name: 'config.saude-banco' }">{{ t('config.conexoes.painel') }}</router-link>
      </p>
    </template>
    <section v-if="cargaLida" aria-labelledby="titulo-carga" data-testid="painel-carga">
      <h2 id="titulo-carga">{{ t('config.conexoes.carga') }}</h2>
      <p>{{ t('config.conexoes.cargaTexto') }}</p>
      <p v-if="!carga" data-testid="sem-carga">{{ t('config.conexoes.semCarga') }}</p>
      <template v-else>
        <p data-testid="carga-resumo">
          {{
            t('config.conexoes.cargaResumo', {
              cenario: carga.cenario,
              usuarios: carga.usuarios,
              data: dataHora(carga.executadoEm),
              resultado: t(`config.conexoes.${carga.resultado}`),
            })
          }}
        </p>
        <table data-testid="tabela-carga">
          <caption>
            {{
              t('config.conexoes.carga')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('config.conexoes.jornada') }}</th>
              <th scope="col">{{ t('config.conexoes.p95') }}</th>
              <th scope="col">{{ t('config.conexoes.meta') }}</th>
              <th scope="col">{{ t('config.conexoes.atendida') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="j in carga.jornadas" :key="j.jornada">
              <td>{{ j.jornada }}</td>
              <td>{{ j.p95Ms ?? '—' }}</td>
              <td>{{ j.metaMs ?? '—' }}</td>
              <td>
                {{
                  j.atendida === null ? '—' : j.atendida ? t('config.conexoes.sim') : t('config.conexoes.nao')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <table v-if="carga.outroSistema.length" data-testid="tabela-carga-outro">
          <caption>
            {{
              t('config.conexoes.outroSistema')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('config.conexoes.operacaoChave') }}</th>
              <th scope="col">{{ t('config.conexoes.antes') }}</th>
              <th scope="col">{{ t('config.conexoes.durante') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in carga.outroSistema" :key="o.operacao">
              <td>{{ o.operacao }}</td>
              <td>{{ o.antesP95Ms ?? '—' }}</td>
              <td>{{ o.duranteP95Ms ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p>
          {{
            t('config.conexoes.monResumo', {
              longa: carga.mon.transacaoMaisLongaMs ?? '—',
              acima: carga.mon.acimaDoLimite ?? '—',
              escritas: carga.mon.escritas ?? '—',
            })
          }}
        </p>
      </template>
    </section>
    <!-- M16: saúde do vigia de mudanças (canais, atraso, consultas por ciclo). -->
    <SaudeVigia />
  </section>
</template>
